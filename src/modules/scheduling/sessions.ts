import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import {
  appointments,
  customers,
  schedulingSessions,
  type AppointmentRow,
  type ReminderStatus,
  type SchedulingSessionRow,
} from "../../db/schema.js";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A sessão expira 30 minutos depois da última interação (research.md R4). */
export const SESSION_TTL_MS = 30 * 60_000;

export type SessionDraft = Pick<SchedulingSessionRow, "conversationId" | "flow" | "step"> &
  Partial<Pick<SchedulingSessionRow, "options" | "selectedStart" | "customerName" | "service" | "appointmentId" | "misunderstoodCount">>;

/** Horário da aba de agendamentos, com as anotações e o nome do cadastro do cliente (specs/006). */
export type UpcomingAppointment = AppointmentRow & { notes: string | null; registeredName: string | null };

/** Violação de chave única (23505), venha ela do postgres-js ou do PGlite, embrulhada ou não pelo Drizzle. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}

/** Sessões de agendamento e agendamentos feitos pelo assistente ou pelo painel (data-model.md). */
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
        service: draft.service ?? null,
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
      conversationId: string | null;
      phone: string;
      origin: "assistant" | "panel";
      googleEventId: string;
      calendarId: string;
      startsAt: Date;
      endsAt: Date;
      customerName: string;
      service: string;
      reminderStatus: ReminderStatus;
      customerId?: string | null;
    }): Promise<AppointmentRow | null> {
      try {
        const [row] = await db.insert(appointments).values(v).returning();
        return row;
      } catch (err) {
        if (isUniqueViolation(err)) return null;
        throw err;
      }
    },

    /** Liga o agendamento ao cliente do cadastro (specs/005). */
    async setCustomer(appointmentId: string, customerId: string): Promise<void> {
      await db.update(appointments).set({ customerId }).where(eq(appointments.id, appointmentId));
    },

    async findAppointment(id: string): Promise<AppointmentRow | null> {
      const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
      return row ?? null;
    },

    /** O próximo horário marcado do telefone, de qualquer conversa ou do painel (FR-019; specs/006 R1). */
    async findFutureBooked(phone: string, now: Date): Promise<AppointmentRow | null> {
      const [row] = await db
        .select()
        .from(appointments)
        .where(and(eq(appointments.phone, phone), eq(appointments.status, "booked"), gt(appointments.startsAt, now)))
        .orderBy(asc(appointments.startsAt))
        .limit(1);
      return row ?? null;
    },

    /** Todos os horários futuros marcados do telefone (troca de nome do cliente, specs/006 R6). */
    async futureBookedByPhone(phone: string, now: Date): Promise<AppointmentRow[]> {
      return db
        .select()
        .from(appointments)
        .where(and(eq(appointments.phone, phone), eq(appointments.status, "booked"), gt(appointments.startsAt, now)))
        .orderBy(asc(appointments.startsAt));
    },

    /** Horários marcados que começam depois de `from` e até `to`, em ordem (aba de agendamentos, specs/006). */
    async listUpcoming(from: Date, to: Date): Promise<UpcomingAppointment[]> {
      const rows = await db
        .select({ appointment: appointments, notes: customers.notes, registeredName: customers.name })
        .from(appointments)
        // Pelo vínculo do agendamento ou, se ele caiu (cadastro excluído e refeito), pelo telefone
        .leftJoin(
          customers,
          or(eq(customers.id, appointments.customerId), and(isNull(appointments.customerId), eq(customers.phone, appointments.phone))),
        )
        .where(and(eq(appointments.status, "booked"), gt(appointments.startsAt, from), lte(appointments.startsAt, to)))
        .orderBy(asc(appointments.startsAt));
      return rows.map((r) => ({ ...r.appointment, notes: r.notes ?? null, registeredName: r.registeredName ?? null }));
    },

    async setCustomerName(appointmentId: string, customerName: string): Promise<void> {
      await db.update(appointments).set({ customerName, updatedAt: new Date() }).where(eq(appointments.id, appointmentId));
    },

    async markCancelled(id: string, by: "customer" | "calendar"): Promise<void> {
      await db
        .update(appointments)
        .set({ status: "cancelled", cancelledBy: by, updatedAt: new Date() })
        .where(eq(appointments.id, id));
    },

    /**
     * Muda o horário; devolve false se o novo horário já estiver tomado por outro agendamento. O horário novo tem o
     * seu próprio lembrete e precisa de nova confirmação (specs/006 R10).
     */
    async updateTimes(id: string, startsAt: Date, endsAt: Date, reminderStatus: ReminderStatus): Promise<boolean> {
      try {
        await db
          .update(appointments)
          .set({
            startsAt,
            endsAt,
            reminderStatus,
            reminderReason: null,
            reminderSentAt: null,
            confirmedAt: null,
            confirmedBy: null,
            updatedAt: new Date(),
          })
          .where(eq(appointments.id, id));
        return true;
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },

    // --- Lembrete e confirmação (specs/006 US4) ---

    /** Horários marcados com lembrete pendente que começam até `until`, em ordem. */
    async dueReminders(until: Date): Promise<AppointmentRow[]> {
      return db
        .select()
        .from(appointments)
        .where(and(eq(appointments.status, "booked"), eq(appointments.reminderStatus, "pending"), lte(appointments.startsAt, until)))
        .orderBy(asc(appointments.startsAt));
    },

    /** Marca o lembrete como enviado só se ainda estiver pendente; false se outro passo já marcou (SC-006). */
    async markReminderSent(id: string, at: Date): Promise<boolean> {
      const rows = await db
        .update(appointments)
        .set({ reminderStatus: "sent", reminderReason: null, reminderSentAt: at, updatedAt: at })
        .where(and(eq(appointments.id, id), eq(appointments.reminderStatus, "pending")))
        .returning({ id: appointments.id });
      return rows.length > 0;
    },

    /** Guarda por que o lembrete ainda não saiu; ele continua pendente. */
    async setReminderReason(id: string, reason: string): Promise<void> {
      await db
        .update(appointments)
        .set({ reminderReason: reason })
        .where(and(eq(appointments.id, id), eq(appointments.reminderStatus, "pending")));
    },

    /** O lembrete não vai mais sair; false se ele já não estava pendente. */
    async markReminderNotSent(id: string, reason: string): Promise<boolean> {
      const rows = await db
        .update(appointments)
        .set({ reminderStatus: "not_sent", reminderReason: reason, updatedAt: new Date() })
        .where(and(eq(appointments.id, id), eq(appointments.reminderStatus, "pending")))
        .returning({ id: appointments.id });
      return rows.length > 0;
    },

    /** Confirmação do cliente (YES ao lembrete) ou do operador; um lembrete ainda pendente deixa de ser necessário. */
    async confirm(id: string, by: "customer" | "operator", at: Date): Promise<AppointmentRow | null> {
      const current = await this.findAppointment(id);
      if (!current || current.confirmedAt) return current;
      const [row] = await db
        .update(appointments)
        .set({
          confirmedAt: at,
          confirmedBy: by,
          ...(current.reminderStatus === "pending" ? { reminderStatus: "not_needed" as const, reminderReason: null } : {}),
          updatedAt: at,
        })
        .where(eq(appointments.id, id))
        .returning();
      return row ?? null;
    },

    /** O próximo horário do telefone cujo lembrete saiu e ainda não foi confirmado (resposta ao lembrete, R5). */
    async findReminderAwaiting(phone: string, now: Date): Promise<AppointmentRow | null> {
      const [row] = await db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.phone, phone),
            eq(appointments.status, "booked"),
            eq(appointments.reminderStatus, "sent"),
            isNull(appointments.confirmedAt),
            gt(appointments.startsAt, now),
          ),
        )
        .orderBy(asc(appointments.startsAt))
        .limit(1);
      return row ?? null;
    },
  };
}

export type SchedulingStore = ReturnType<typeof createSchedulingStore>;

/** Métodos que gravam em `appointments`: depois de cada um, a aba de agendamentos é avisada (specs/006 R9). */
const APPOINTMENT_WRITES = [
  "insertBooked",
  "setCustomer",
  "setCustomerName",
  "markCancelled",
  "updateTimes",
  "markReminderSent",
  "setReminderReason",
  "markReminderNotSent",
  "confirm",
] as const satisfies readonly (keyof SchedulingStore)[];

/** O store com os métodos de escrita em `appointments` chamando `onChange` depois de gravar. */
export function withAppointmentEvents(store: SchedulingStore, onChange: () => void): SchedulingStore {
  const wrapped = { ...store };
  for (const name of APPOINTMENT_WRITES) {
    const original = store[name] as (...args: unknown[]) => Promise<unknown>;
    (wrapped as Record<string, unknown>)[name] = async (...args: unknown[]) => {
      const result = await original.apply(store, args);
      onChange();
      return result;
    };
  }
  return wrapped;
}
