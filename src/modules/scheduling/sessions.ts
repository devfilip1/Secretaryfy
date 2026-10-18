import { and, asc, eq, gt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import {
  appointments,
  schedulingSessions,
  type AppointmentRow,
  type SchedulingSessionRow,
} from "../../db/schema.js";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A sessão expira 30 minutos depois da última interação (research.md R4). */
export const SESSION_TTL_MS = 30 * 60_000;

export type SessionDraft = Pick<SchedulingSessionRow, "conversationId" | "flow" | "step"> &
  Partial<Pick<SchedulingSessionRow, "options" | "selectedStart" | "customerName" | "appointmentId" | "misunderstoodCount">>;

/** Violação de chave única (23505), venha ela do postgres-js ou do PGlite, embrulhada ou não pelo Drizzle. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}

/** Sessões de agendamento e agendamentos feitos pelo assistente (data-model.md). */
export function createSchedulingStore(db: Db) {
  return {
    /** Sessão da conversa; a vencida é apagada e conta como inexistente. */
    async getSession(conversationId: string, now: Date): Promise<SchedulingSessionRow | null> {
      const [row] = await db.select().from(schedulingSessions).where(eq(schedulingSessions.conversationId, conversationId));
      if (!row) return null;
      if (row.expiresAt <= now) {
        await this.clearSession(conversationId);
        return null;
      }
      return row;
    },

    /** Grava a etapa atual, renovando o prazo. O que não vier no rascunho volta ao padrão (contador zerado). */
    async saveSession(draft: SessionDraft, now: Date): Promise<SchedulingSessionRow> {
      const values = {
        flow: draft.flow,
        step: draft.step,
        options: draft.options ?? [],
        selectedStart: draft.selectedStart ?? null,
        customerName: draft.customerName ?? null,
        appointmentId: draft.appointmentId ?? null,
        misunderstoodCount: draft.misunderstoodCount ?? 0,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        updatedAt: now,
      };
      const [row] = await db
        .insert(schedulingSessions)
        .values({ conversationId: draft.conversationId, ...values })
        .onConflictDoUpdate({ target: schedulingSessions.conversationId, set: values })
        .returning();
      return row;
    },

    async clearSession(conversationId: string): Promise<void> {
      await db.delete(schedulingSessions).where(eq(schedulingSessions.conversationId, conversationId));
    },

    /** Grava o agendamento; devolve null se o horário já estiver tomado (índice único, research.md R9). */
    async insertBooked(v: {
      id: string;
      conversationId: string;
      googleEventId: string;
      calendarId: string;
      startsAt: Date;
      endsAt: Date;
      customerName: string;
    }): Promise<AppointmentRow | null> {
      try {
        const [row] = await db.insert(appointments).values(v).returning();
        return row;
      } catch (err) {
        if (isUniqueViolation(err)) return null;
        throw err;
      }
    },

    async findAppointment(id: string): Promise<AppointmentRow | null> {
      const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
      return row ?? null;
    },

    /** O próximo horário marcado da conversa (FR-019). */
    async findFutureBooked(conversationId: string, now: Date): Promise<AppointmentRow | null> {
      const [row] = await db
        .select()
        .from(appointments)
        .where(
          and(eq(appointments.conversationId, conversationId), eq(appointments.status, "booked"), gt(appointments.startsAt, now)),
        )
        .orderBy(asc(appointments.startsAt))
        .limit(1);
      return row ?? null;
    },

    async markCancelled(id: string, by: "customer" | "calendar"): Promise<void> {
      await db
        .update(appointments)
        .set({ status: "cancelled", cancelledBy: by, updatedAt: new Date() })
        .where(eq(appointments.id, id));
    },

    /** Muda o horário; devolve false se o novo horário já estiver tomado por outro agendamento. */
    async updateTimes(id: string, startsAt: Date, endsAt: Date): Promise<boolean> {
      try {
        await db.update(appointments).set({ startsAt, endsAt, updatedAt: new Date() }).where(eq(appointments.id, id));
        return true;
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },
  };
}

export type SchedulingStore = ReturnType<typeof createSchedulingStore>;
