import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ConnectionStore } from "../modules/google/connection.js";
import { CalendarUnavailable, type CalendarGateway } from "../modules/google/gateway.js";
import { rulesSchema, type Rules, type RulesStore } from "../modules/scheduling/rules.js";

interface Deps {
  connection: ConnectionStore;
  calendar: CalendarGateway;
  rules: RulesStore;
  buildConnectUrl: () => string;
  revoke: (refreshToken: string) => Promise<void>;
}

const selectionBody = z.object({ calendarId: z.string().min(1) });

/** API da agenda no painel (contracts/panel-api.md). A autenticação fica no hook de panel-session.ts. */
export function panelCalendarRoutes({ connection, calendar, rules, buildConnectUrl, revoke }: Deps) {
  async function state() {
    return { connection: await connection.get(), rules: await rules.get() };
  }

  /** Lista as agendas da conta, traduzindo os erros do Google em 409/502. */
  async function calendarsOr(reply: FastifyReply) {
    if ((await connection.get()).status === "disconnected") {
      reply.code(409).send({ error: "calendar_disconnected" });
      return null;
    }
    try {
      return await calendar.listCalendars();
    } catch (err) {
      if (!(err instanceof CalendarUnavailable)) throw err;
      reply.code(502).send({ error: "calendar_unavailable" });
      return null;
    }
  }

  return async function (app: FastifyInstance) {
    app.get("/api/calendar", async () => state());

    app.post("/api/calendar/connect", async () => ({ url: buildConnectUrl() }));

    app.get("/api/calendar/calendars", async (_req, reply) => {
      const calendars = await calendarsOr(reply);
      return calendars && { calendars };
    });

    app.put("/api/calendar/selection", async (req, reply) => {
      const parsed = selectionBody.safeParse(req.body);
      if (!parsed.success) return reply.code(422).send({ error: "invalid_calendar" });
      const calendars = await calendarsOr(reply);
      if (!calendars) return reply;
      const chosen = calendars.find((c) => c.id === parsed.data.calendarId);
      if (!chosen) return reply.code(422).send({ error: "invalid_calendar" });
      await connection.selectCalendar({ id: chosen.id, name: chosen.name, timeZone: chosen.timeZone });
      return state();
    });

    app.put("/api/calendar/rules", async (req, reply) => {
      const parsed = rulesSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(422).send({
          error: "invalid_rules",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      await rules.save(parsed.data as Rules);
      return state();
    });

    app.delete("/api/calendar", async (req, reply) => {
      const token = await connection.remove();
      if (token) {
        // Desconecta mesmo se o Google não responder: o token deixa de existir aqui
        await revoke(token).catch((err) => req.log.warn({ err: (err as Error).message }, "falha ao revogar o token do Google"));
        req.log.info("agenda Google desconectada");
      }
      return reply.code(204).send();
    });
  };
}
