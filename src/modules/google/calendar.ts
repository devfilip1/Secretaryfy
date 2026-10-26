import { google, type calendar_v3 } from "googleapis";
import type { ActiveConnection, ConnectionStore } from "./connection.js";
import { CalendarAuthError, CalendarUnavailable, FALLBACK_TIME_ZONE, type CalendarGateway } from "./gateway.js";
import { authClientFor } from "./oauth.js";

const TIMEOUT_MS = 10_000;

/** Status HTTP de um erro do googleapis (GaxiosError), quando houver. */
function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; code?: number | string; response?: { status?: number } };
  return e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : undefined);
}

function isInvalidGrant(err: unknown): boolean {
  const e = err as { message?: string; response?: { data?: { error?: string } } };
  return e.response?.data?.error === "invalid_grant" || /invalid_grant/.test(e.message ?? "");
}

/** Agenda Google da clínica, sempre na agenda escolhida em calendar_connection (contracts/google-calendar.md). */
export function createGoogleCalendar({ connection }: { connection: Pick<ConnectionStore, "getForUse" | "markNeedsReauth"> }): CalendarGateway {
  async function withApi<T>(what: string, fn: (api: calendar_v3.Calendar, conn: ActiveConnection) => Promise<T>): Promise<T> {
    const conn = await connection.getForUse();
    if (!conn) throw new CalendarUnavailable("agenda desconectada");
    if (conn.status === "needs_reauth") throw new CalendarAuthError("a agenda precisa ser reconectada");
    const api = google.calendar({ version: "v3", auth: authClientFor(conn.refreshToken) });
    try {
      return await fn(api, conn);
    } catch (err) {
      const status = statusOf(err);
      // Token recusado, escopo retirado ou a agenda escolhida sumiu: o operador precisa reconectar ou escolher outra
      if (isInvalidGrant(err) || status === 401 || status === 403 || (status === 404 && what !== "evento")) {
        await connection.markNeedsReauth();
        throw new CalendarAuthError(`Google recusou o acesso (${what})`, { cause: err });
      }
      if (err instanceof CalendarUnavailable) throw err;
      throw new CalendarUnavailable(`Google Agenda indisponível (${what})`, { cause: err });
    }
  }

  const opts = { timeout: TIMEOUT_MS };

  return {
    listCalendars() {
      return withApi("agendas", async (api) => {
        const { data } = await api.calendarList.list({ minAccessRole: "writer" }, opts);
        return (data.items ?? [])
          .filter((c) => c.id)
          .map((c) => ({
            id: c.primary ? "primary" : c.id!,
            name: c.summaryOverride ?? c.summary ?? c.id!,
            timeZone: c.timeZone || FALLBACK_TIME_ZONE,
            primary: c.primary === true,
          }));
      });
    },

    busy(from, to) {
      return withApi("ocupação", async (api, conn) => {
        const { data } = await api.freebusy.query(
          {
            requestBody: {
              timeMin: from.toISOString(),
              timeMax: to.toISOString(),
              timeZone: conn.timeZone,
              items: [{ id: conn.calendarId }],
            },
          },
          opts,
        );
        const cal = data.calendars?.[conn.calendarId] ?? Object.values(data.calendars ?? {})[0];
        if (cal?.errors?.length) throw new CalendarUnavailable(`freebusy: ${cal.errors.map((e) => e.reason).join(", ")}`);
        return (cal?.busy ?? []).map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
      });
    },

    createEvent(event) {
      return withApi("criar evento", async (api, conn) => {
        const { data } = await api.events.insert(
          {
            calendarId: conn.calendarId,
            sendUpdates: "none",
            requestBody: {
              summary: event.summary,
              description: event.description,
              start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
              end: { dateTime: event.end.toISOString(), timeZone: event.timeZone },
              extendedProperties: { private: event.properties },
            },
          },
          opts,
        );
        if (!data.id) throw new CalendarUnavailable("Google não devolveu o id do evento");
        return { eventId: data.id };
      });
    },

    getEvent(eventId) {
      return withApi("evento", async (api, conn) => {
        try {
          const { data } = await api.events.get({ calendarId: conn.calendarId, eventId }, opts);
          if (data.status === "cancelled" || !data.start?.dateTime || !data.end?.dateTime) return null;
          return { start: new Date(data.start.dateTime), end: new Date(data.end.dateTime) };
        } catch (err) {
          const status = statusOf(err);
          if (status === 404 || status === 410) return null;
          throw err;
        }
      });
    },

    moveEvent(eventId, start, end) {
      return withApi("mover evento", async (api, conn) => {
        await api.events.patch(
          {
            calendarId: conn.calendarId,
            eventId,
            sendUpdates: "none",
            requestBody: {
              start: { dateTime: start.toISOString(), timeZone: conn.timeZone },
              end: { dateTime: end.toISOString(), timeZone: conn.timeZone },
            },
          },
          opts,
        );
      });
    },

    renameEvent(eventId, summary) {
      return withApi("renomear evento", async (api, conn) => {
        try {
          await api.events.patch({ calendarId: conn.calendarId, eventId, sendUpdates: "none", requestBody: { summary } }, opts);
        } catch (err) {
          const status = statusOf(err);
          // Apagado no Google: não há título para trocar
          if (status === 404 || status === 410) return;
          throw err;
        }
      });
    },

    deleteEvent(eventId) {
      return withApi("evento", async (api, conn) => {
        try {
          await api.events.delete({ calendarId: conn.calendarId, eventId, sendUpdates: "none" }, opts);
        } catch (err) {
          const status = statusOf(err);
          // Já apagado no Google: o resultado é o mesmo
          if (status === 404 || status === 410) return;
          throw err;
        }
      });
    },
  };
}
