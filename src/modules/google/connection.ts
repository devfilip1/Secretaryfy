import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { decrypt, encrypt } from "../../config/crypto.js";
import * as schema from "../../db/schema.js";
import { calendarConnection, schedulingSessions, type CalendarConnectionRow } from "../../db/schema.js";
import type { Publish } from "../inbox/events.js";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Estado da agenda mostrado no painel (contracts/panel-api.md, GET /api/calendar). */
export type CalendarConnectionJson =
  | { status: "disconnected"; email: null; calendarId: null; calendarName: null; timeZone: null }
  | {
      status: "connected" | "needs_reauth";
      email: string;
      calendarId: string;
      calendarName: string;
      timeZone: string;
    };

/** O que o gateway do Google precisa para chamar a API. */
export interface ActiveConnection {
  refreshToken: string;
  calendarId: string;
  timeZone: string;
  status: "connected" | "needs_reauth";
}

const DISCONNECTED: CalendarConnectionJson = {
  status: "disconnected",
  email: null,
  calendarId: null,
  calendarName: null,
  timeZone: null,
};

function present(row: CalendarConnectionRow | undefined): CalendarConnectionJson {
  if (!row) return DISCONNECTED;
  return {
    status: row.status,
    email: row.email,
    calendarId: row.calendarId,
    calendarName: row.calendarName,
    timeZone: row.timeZone,
  };
}

/** A agenda da clínica: uma linha só em calendar_connection (data-model.md). */
export function createConnectionStore({ db, publish }: { db: Db; publish: Publish }) {
  async function row() {
    const [r] = await db.select().from(calendarConnection).where(eq(calendarConnection.id, 1));
    return r;
  }

  function changed(r: CalendarConnectionRow | undefined) {
    const connection = present(r);
    publish({ type: "calendar.updated", connection });
    return connection;
  }

  return {
    async get(): Promise<CalendarConnectionJson> {
      return present(await row());
    },

    /** Conexão com o token descriptografado, ou null se desconectada. */
    async getForUse(): Promise<ActiveConnection | null> {
      const r = await row();
      if (!r) return null;
      return { refreshToken: decrypt(r.refreshTokenEnc), calendarId: r.calendarId, timeZone: r.timeZone, status: r.status };
    },

    /** Grava a conexão nova (ou a reconexão), com a agenda já escolhida. */
    async save(v: {
      email: string;
      refreshToken: string;
      scopes: string;
      calendar: { id: string; name: string; timeZone: string };
    }): Promise<CalendarConnectionJson> {
      const values = {
        email: v.email,
        refreshTokenEnc: encrypt(v.refreshToken),
        scopes: v.scopes,
        calendarId: v.calendar.id,
        calendarName: v.calendar.name,
        timeZone: v.calendar.timeZone,
        status: "connected" as const,
        connectedAt: new Date(),
        updatedAt: new Date(),
      };
      const [r] = await db
        .insert(calendarConnection)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: calendarConnection.id, set: values })
        .returning();
      return changed(r);
    },

    /**
     * Acompanha a agenda escolhida no Google: se o fuso ou o nome mudaram lá, atualiza aqui. Devolve true se mudou.
     * O fuso gravado na conexão é o que o agendamento usa para todos os horários.
     */
    async syncCalendar(calendars: { id: string; name: string; timeZone: string }[]): Promise<boolean> {
      const r = await row();
      const current = r && calendars.find((c) => c.id === r.calendarId);
      if (!current || (current.timeZone === r.timeZone && current.name === r.calendarName)) return false;
      await this.selectCalendar(current);
      return true;
    },

    async selectCalendar(calendar: { id: string; name: string; timeZone: string }): Promise<CalendarConnectionJson> {
      const [r] = await db
        .update(calendarConnection)
        .set({ calendarId: calendar.id, calendarName: calendar.name, timeZone: calendar.timeZone, updatedAt: new Date() })
        .where(eq(calendarConnection.id, 1))
        .returning();
      return changed(r);
    },

    /** O Google recusou o token: o painel passa a pedir reconexão (US3, cenário 6). */
    async markNeedsReauth(): Promise<void> {
      // Só a linha ainda conectada muda: repetir não publica de novo
      const [r] = await db
        .update(calendarConnection)
        .set({ status: "needs_reauth", updatedAt: new Date() })
        .where(and(eq(calendarConnection.id, 1), eq(calendarConnection.status, "connected")))
        .returning();
      if (r) changed(r);
    },

    /** Apaga a conexão e as sessões em andamento. Devolve o refresh token para revogar, ou null. */
    async remove(): Promise<string | null> {
      const [r] = await db.delete(calendarConnection).where(eq(calendarConnection.id, 1)).returning();
      if (!r) return null;
      await db.delete(schedulingSessions);
      changed(undefined);
      return decrypt(r.refreshTokenEnc);
    },
  };
}

export type ConnectionStore = ReturnType<typeof createConnectionStore>;
