import { google } from "googleapis";
import { sign } from "../../config/crypto.js";

/** Escopos mais estreitos que cobrem listar agendas, ler a ocupação e criar, mover e apagar eventos (research.md R7). */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];

const CALENDAR_SCOPES = GOOGLE_SCOPES.filter((s) => s.startsWith("https://"));

/** Valor assinado no `state`: só sai de uma rota autenticada do painel e vale 10 minutos. */
export const CONNECT_STATE = "calendar-connect";

/** Cliente OAuth do Google Cloud e o endereço de volta do consentimento (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_URL). */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * As credenciais do Google Cloud parecem reais? Um GOOGLE_CLIENT_ID de exemplo leva o operador a um
 * "Erro 401: invalid_client" na tela do Google; melhor avisar no painel antes.
 */
export function isGoogleConfigured(clientId: string, clientSecret: string): boolean {
  return /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId) && clientSecret.length >= 20;
}

/** Escopos de agenda que faltam entre os concedidos (o operador pode desmarcá-los na tela do Google). */
export function missingScopes(granted: string): string[] {
  const have = new Set(granted.split(" "));
  return CALENDAR_SCOPES.filter((s) => !have.has(s));
}

export interface GrantedAccess {
  refreshToken: string;
  scopes: string;
  email: string;
}

/** Fluxo OAuth com o Google para conectar a agenda da clínica (consentimento, troca do código, revogação). */
export function createGoogleOAuth({ clientId, clientSecret, redirectUri }: GoogleOAuthConfig) {
  function newOAuthClient() {
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  return {
    /** Ver isGoogleConfigured: confere estas credenciais. */
    isConfigured: (): boolean => isGoogleConfigured(clientId, clientSecret),

    /** Link da tela de consentimento do Google para conectar a agenda da clínica. */
    buildConnectUrl(): string {
      return newOAuthClient().generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: false,
        scope: GOOGLE_SCOPES,
        state: sign(CONNECT_STATE, 600),
      });
    },

    /** Troca o `code` do callback pelo refresh token e descobre o e-mail da conta. */
    async exchangeCode(code: string): Promise<GrantedAccess> {
      const client = newOAuthClient();
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token) throw new Error("Google não retornou refresh_token");
      client.setCredentials(tokens);

      const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
      if (!data.email) throw new Error("Não foi possível obter o email da conta Google");
      return { refreshToken: tokens.refresh_token, scopes: tokens.scope ?? "", email: data.email };
    },

    /** Revoga o acesso no Google (desconectar, FR-004). */
    async revoke(refreshToken: string): Promise<void> {
      await newOAuthClient().revokeToken(refreshToken);
    },

    /** Cliente OAuth autenticado com o refresh token da clínica. Renova o access token sozinho. */
    authClientFor(refreshToken: string) {
      const client = newOAuthClient();
      client.setCredentials({ refresh_token: refreshToken });
      return client;
    },
  };
}

export type GoogleOAuth = ReturnType<typeof createGoogleOAuth>;
