import type { FastifyInstance } from "fastify";
import { verifySigned } from "../config/crypto.js";
import type { ConnectionStore } from "../modules/google/connection.js";
import type { CalendarOption } from "../modules/google/gateway.js";
import { CONNECT_STATE, missingScopes, type GrantedAccess } from "../modules/google/oauth.js";

interface Deps {
  connection: Pick<ConnectionStore, "save">;
  /** Para onde o Google devolve o operador: o painel (PANEL_URL ou PUBLIC_URL) */
  panelUrl: string;
  exchangeCode: (code: string) => Promise<GrantedAccess>;
  /** Agendas da conta recém-autorizada, para escolher a principal e o fuso */
  listCalendars: (refreshToken: string) => Promise<CalendarOption[]>;
}

type Outcome = "connected" | "denied" | "error" | "missing_scope";

/**
 * Volta do Google depois do consentimento (contracts/panel-api.md). Não depende do cookie do painel, que é
 * SameSite=Strict e não acompanha o redirecionamento: a proteção é o `state` assinado.
 */
export function googleOAuthRoutes({ connection, panelUrl, exchangeCode, listCalendars }: Deps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      "/auth/google/callback",
      async (req, reply) => {
        const done = (outcome: Outcome) => reply.redirect(`${panelUrl}/#/agenda?google=${outcome}`);
        const { code, state, error } = req.query;

        if (error) {
          req.log.info({ error }, "autorização do Google cancelada");
          return done("denied");
        }
        if (!code || !state || verifySigned(state) !== CONNECT_STATE) return done("error");

        try {
          const access = await exchangeCode(code);
          if (missingScopes(access.scopes).length > 0) {
            req.log.warn({ missing: missingScopes(access.scopes) }, "escopos de agenda não concedidos");
            return done("missing_scope");
          }
          const calendars = await listCalendars(access.refreshToken);
          const main = calendars.find((c) => c.primary) ?? calendars[0];
          if (!main) throw new Error("a conta não tem agenda em que possa criar eventos");
          await connection.save({ ...access, calendar: { id: main.id, name: main.name, timeZone: main.timeZone } });
          req.log.info({ email: access.email }, "agenda Google conectada");
          return done("connected");
        } catch (err) {
          req.log.error({ err: (err as Error).message }, "falha ao conectar a agenda Google");
          return done("error");
        }
      },
    );
  };
}
