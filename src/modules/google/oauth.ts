import { google } from "googleapis";
import { sign } from "../../config/crypto.js";
import { env } from "../../config/env.js";

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

export const REDIRECT_URI = `${env.PUBLIC_URL}/auth/google/callback`;

function newOAuthClient() {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

/** Link da tela de consentimento do Google para conectar a agenda da clínica. */
export function buildConnectUrl(): string {
  return newOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: GOOGLE_SCOPES,
    state: sign(CONNECT_STATE, 600),
  });
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

/** Troca o `code` do callback pelo refresh token e descobre o e-mail da conta. */
export async function exchangeCode(code: string): Promise<GrantedAccess> {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google não retornou refresh_token");
  client.setCredentials(tokens);

  const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  if (!data.email) throw new Error("Não foi possível obter o email da conta Google");
  return { refreshToken: tokens.refresh_token, scopes: tokens.scope ?? "", email: data.email };
}

/** Revoga o acesso no Google (desconectar, FR-004). */
export async function revoke(refreshToken: string): Promise<void> {
  await newOAuthClient().revokeToken(refreshToken);
}

/** Cliente OAuth autenticado com o refresh token da clínica. Renova o access token sozinho. */
export function authClientFor(refreshToken: string) {
  const client = newOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
