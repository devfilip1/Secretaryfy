import { randomUUID } from "node:crypto";
import type { AppointmentRow } from "../../db/schema.js";
import type { CustomerRepository } from "../customers/repository.js";
import type { ConnectionStore } from "../google/connection.js";
import type { CalendarGateway } from "../google/gateway.js";
import type { InboxService } from "../inbox/service.js";
import { initialReminderStatus } from "../reminders/status.js";
import { isSlotAvailable, STAFF_MAX_DAYS_AHEAD } from "./availability.js";
import { withCalendarLock } from "./lock.js";
import type { ServiceCatalog } from "./catalog.js";
import type { SystemNote } from "../inbox/system-note.js";
import type { RulesStore } from "./rules.js";
import type { SchedulingStore } from "./sessions.js";

/** Antecedência padrão do lembrete: 24 h (specs/006 FR-020). */
export const DEFAULT_REMINDER_LEAD_MINUTES = 1440;

export type BookResult =
  | { kind: "booked"; appointment: AppointmentRow }
  | { kind: "slot_taken" }
  | { kind: "already_booked"; appointment: AppointmentRow }
  | { kind: "calendar_unavailable" };

export type CancelResult =
  | { kind: "cancelled"; appointment: AppointmentRow }
  | { kind: "not_found" }
  | { kind: "calendar_unavailable" };

interface SyncDeps {
  calendar: Pick<CalendarGateway, "getEvent">;
  store: Pick<SchedulingStore, "markCancelled" | "updateTimes">;
  inbox: Pick<InboxService, "recordSystem">;
  reminderLeadMinutes: number;
}

/**
 * Confere o horário no Google, a fonte da verdade (FR-018a): apagado lá conta como cancelado, movido passa a valer no
 * horário novo, com lembrete recalculado. Devolve o horário ainda futuro, ou null. Usado pelo fluxo do WhatsApp, pela
 * marcação do painel e pelo agendador de lembretes.
 */
export async function syncAppointment(
  { calendar, store, inbox, reminderLeadMinutes }: SyncDeps,
  appt: AppointmentRow | null,
  { now, timeZone, conversationId }: { now: Date; timeZone: string; conversationId: string | null },
): Promise<AppointmentRow | null> {
  if (!appt || appt.status !== "booked") return null;
  const event = await calendar.getEvent(appt.googleEventId);
  if (!event) {
    await store.markCancelled(appt.id, "calendar");
    if (conversationId) await inbox.recordSystem(conversationId, { kind: "cancelled_in_calendar", start: appt.startsAt.toISOString(), timeZone });
    return null;
  }
  if (event.start.getTime() !== appt.startsAt.getTime() || event.end.getTime() !== appt.endsAt.getTime()) {
    const reminderStatus = initialReminderStatus(event.start, now, reminderLeadMinutes);
    await store.updateTimes(appt.id, event.start, event.end, reminderStatus);
    appt = {
      ...appt,
      startsAt: event.start,
      endsAt: event.end,
      reminderStatus,
      reminderReason: null,
      reminderSentAt: null,
      confirmedAt: null,
      confirmedBy: null,
    };
  }
  return appt.startsAt > now ? appt : null;
}

interface Deps {
  calendar: CalendarGateway;
  connection: Pick<ConnectionStore, "getForUse">;
  rules: Pick<RulesStore, "get">;
  store: SchedulingStore;
  inbox: Pick<InboxService, "recordSystem">;
  /** Cadastro de clientes: quem tem um horário confirmado entra nele (specs/005, US3) */
  customers: Pick<CustomerRepository, "upsert">;
  /** O título do tratamento para a agenda, a nota e o histórico: a chave guardada nunca sai (ADR 0014) */
  catalog: Pick<ServiceCatalog, "label" | "minutes">;
  log?: { error: (obj: object, msg: string) => void };
  now?: () => Date;
  reminderLeadMinutes?: number;
}

/**
 * Cria e cancela horários na agenda (specs/006 research.md R2). Um motor só, para o assistente e para o painel: mesma
 * trava, mesma regra de um horário futuro por telefone, mesma conferência da ocupação logo antes de criar o evento
 * (FR-014, FR-015).
 */
export function createBooking({
  calendar,
  connection,
  rules: rulesStore,
  store,
  inbox,
  customers,
  catalog,
  log = console,
  now: clock = () => new Date(),
  reminderLeadMinutes = DEFAULT_REMINDER_LEAD_MINUTES,
}: Deps) {
  const syncDeps = { calendar, store, inbox, reminderLeadMinutes };

  /**
   * Com o evento criado e o agendamento gravado, o cliente entra no cadastro (FR-015 a FR-018 da 005). Uma falha aqui
   * não desfaz a marcação: fica no log, e o cliente é incluído no próximo agendamento.
   */
  async function registerCustomer(appointmentId: string, phone: string, name: string, at: Date) {
    try {
      const customer = await customers.upsert({ phone, name, at });
      await store.setCustomer(appointmentId, customer.id);
    } catch (err) {
      log.error({ phone, err }, "falha ao gravar o cliente no cadastro");
    }
  }

  return {
    async bookSlot({
      phone,
      name,
      service,
      start,
      origin,
      conversationId,
      minutes: askedMinutes,
    }: {
      phone: string;
      name: string;
      service: string;
      start: Date;
      origin: "assistant" | "panel";
      /** Conversa do telefone, se houver: recebe o registro no histórico */
      conversationId: string | null;
      /** Duração escolhida pela equipe; o assistente sempre usa a do tratamento */
      minutes?: number;
    }): Promise<BookResult> {
      const conn = await connection.getForUse();
      if (!conn || conn.status !== "connected") return { kind: "calendar_unavailable" };
      const rules = await rulesStore.get();
      const timeZone = conn.timeZone;

      return withCalendarLock(async () => {
        const now = clock();
        const existing = await syncAppointment(syncDeps, await store.findFutureBooked(phone, now), { now, timeZone, conversationId });
        if (existing) return { kind: "already_booked", appointment: existing };

        const minutes = (origin === "panel" ? askedMinutes : undefined) ?? catalog.minutes(service) ?? rules.slotMinutes;
        const end = new Date(start.getTime() + minutes * 60_000);
        const busy = await calendar.busy(start, end);
        // A equipe marca além da janela do paciente (até um ano); o assistente segue a janela de maxDaysAhead
        const maxDaysAhead = origin === "panel" ? STAFF_MAX_DAYS_AHEAD : undefined;
        if (!isSlotAvailable(start, { rules, busy, now, timeZone, minutes, maxDaysAhead })) return { kind: "slot_taken" };

        const id = randomUUID();
        const title = catalog.label(service);
        const { eventId } = await calendar.createEvent({
          // "<nome> — <serviço>" (specs/005 FR-013), com o título do tratamento
          summary: `${name} — ${title}`,
          description: `WhatsApp: +${phone}\nServiço: ${title}\n${origin === "panel" ? "Marcado pelo Secretaryfy (painel)." : "Marcado pelo Secretaryfy."}`,
          start,
          end,
          timeZone,
          properties: { secretaryfy_appointment: id, secretaryfy_phone: phone },
        });
        const appointment = await store.insertBooked({
          id,
          conversationId,
          phone,
          origin,
          googleEventId: eventId,
          calendarId: conn.calendarId,
          startsAt: start,
          endsAt: end,
          customerName: name,
          service,
          reminderStatus: initialReminderStatus(start, now, reminderLeadMinutes),
        });
        if (!appointment) {
          // Outro agendamento ficou com o horário: desfaz o evento recém-criado
          await calendar.deleteEvent(eventId).catch(() => {});
          return { kind: "slot_taken" };
        }

        await registerCustomer(appointment.id, phone, name, now);
        if (conversationId) {
          const at = start.toISOString();
          const note: SystemNote =
            origin === "panel"
              ? { kind: "booked_from_panel", start: at, minutes, service: title, timeZone }
              : { kind: "booked", start: at, minutes, service: title, timeZone };
          await inbox.recordSystem(conversationId, note);
        }
        return { kind: "booked", appointment };
      });
    },

    /**
     * Cancela um horário futuro marcado: apaga o evento, grava quem cancelou e, com conversa, registra no histórico. O
     * Google vem primeiro (FR-018a): quem já apagou o evento lá cancelou, e então o horário vira não encontrado. Sem
     * mensagem ao cliente; o prazo de aviso do paciente fica no fluxo do WhatsApp, não aqui.
     */
    async cancelAppointment({
      id,
      by,
      conversationId,
    }: {
      id: string;
      by: "customer" | "staff";
      /** Conversa do telefone, se houver: recebe o registro no histórico */
      conversationId: string | null;
    }): Promise<CancelResult> {
      const conn = await connection.getForUse();
      if (!conn || conn.status !== "connected") return { kind: "calendar_unavailable" };

      return withCalendarLock(async () => {
        const now = clock();
        const appt = await syncAppointment(syncDeps, await store.findAppointment(id), {
          now,
          timeZone: conn.timeZone,
          conversationId,
        });
        if (!appt) return { kind: "not_found" };

        await calendar.deleteEvent(appt.googleEventId);
        await store.markCancelled(appt.id, by);
        if (conversationId) {
          const startsAt = appt.startsAt.toISOString();
          const note: SystemNote =
            by === "staff"
              ? { kind: "cancelled_by_staff", start: startsAt, timeZone: conn.timeZone }
              : { kind: "cancelled_by_customer", start: startsAt, timeZone: conn.timeZone };
          await inbox.recordSystem(conversationId, note);
        }
        return { kind: "cancelled", appointment: { ...appt, status: "cancelled", cancelledBy: by } };
      });
    },

    /** O próximo horário do telefone, conferido no Google. */
    async currentAppointment(phone: string, conversationId: string | null): Promise<AppointmentRow | null> {
      const conn = await connection.getForUse();
      if (!conn || conn.status !== "connected") return null;
      const now = clock();
      return syncAppointment(syncDeps, await store.findFutureBooked(phone, now), { now, timeZone: conn.timeZone, conversationId });
    },
  };
}

export type Booking = ReturnType<typeof createBooking>;
