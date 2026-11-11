import { DateTime } from "luxon";
import type { AppointmentRow, ConversationRow, SchedulingSessionRow, SessionOption } from "../../../db/schema.js";
import type { CalendarGateway } from "../../google/gateway.js";
import type { InboxService } from "../../inbox/service.js";
import { bookingWindow } from "../availability.js";
import { syncAppointment, type Booking } from "../booking.js";
import { ASSESSMENT, type ServiceCatalog } from "../catalog.js";
import type { FlowResult } from "../flow.js";
import type { Replies } from "../replies.js";
import type { Rules } from "../rules.js";
import type { SchedulingStore, SessionDraft } from "../sessions.js";

/** A parte do serviço de conversas que o fluxo usa */
export type RunInbox = Pick<InboxService, "recordSystem" | "flagNeedsAttention" | "setCustomerName">;

/** Uma mensagem do cliente sendo tratada: os dados da conversa e as ações possíveis. */
export class Run {
  readonly calendar: CalendarGateway;
  readonly store: SchedulingStore;
  readonly inbox: RunInbox;
  readonly booking: Booking;
  readonly reminderLeadMinutes: number;
  readonly replies: Replies;
  readonly catalog: ServiceCatalog;
  readonly conversation: ConversationRow;
  readonly session: SchedulingSessionRow | null;
  readonly knownName: string | null;
  readonly now: Date;
  readonly tz: string;
  private readonly calendarId: string;
  readonly rules: Rules;
  /** Duração do atendimento em andamento: a do tratamento, ou a do horário que se está remarcando (ADR 0015) */
  minutes: number;
  readonly window: ReturnType<typeof bookingWindow>;
  /** Fluxo, agendamento, nome e serviço que passam de uma etapa para a outra */
  carry: Pick<SessionDraft, "flow" | "appointmentId" | "customerName" | "service">;

  constructor(v: {
    calendar: CalendarGateway;
    store: SchedulingStore;
    inbox: RunInbox;
    booking: Booking;
    reminderLeadMinutes: number;
    replies: Replies;
    catalog: ServiceCatalog;
    conversation: ConversationRow;
    session: SchedulingSessionRow | null;
    knownName: string | null;
    mentionedService: string | null;
    now: Date;
    tz: string;
    calendarId: string;
    rules: Rules;
  }) {
    this.calendar = v.calendar;
    this.store = v.store;
    this.inbox = v.inbox;
    this.booking = v.booking;
    this.reminderLeadMinutes = v.reminderLeadMinutes;
    this.replies = v.replies;
    this.catalog = v.catalog;
    this.conversation = v.conversation;
    this.session = v.session;
    this.knownName = v.knownName;
    this.now = v.now;
    this.tz = v.tz;
    this.calendarId = v.calendarId;
    this.rules = v.rules;
    this.minutes = v.rules.slotMinutes;
    this.window = bookingWindow({ rules: v.rules, now: v.now, timeZone: v.tz });
    this.carry = {
      flow: v.session?.flow ?? "book",
      appointmentId: v.session?.appointmentId ?? null,
      customerName: v.session?.customerName ?? null,
      service: v.session?.service ?? v.mentionedService,
    };
  }

  // --- Sessão ---

  save(draft: Pick<SessionDraft, "step"> & Partial<Pick<SessionDraft, "options" | "selectedStart" | "customerName">>) {
    return this.store.saveSession({ conversationId: this.conversation.id, ...this.carry, ...draft }, this.now);
  }

  async finish(reply: string): Promise<FlowResult> {
    await this.store.clearSession(this.conversation.id);
    return { reply };
  }

  // --- Opções numeradas ---

  optionDays(options: SessionOption[]) {
    return options.flatMap((o) => (o.kind === "day" ? [o.date] : []));
  }

  optionSlots(options: SessionOption[]) {
    return options.flatMap((o) => (o.kind === "slot" ? [new Date(o.start)] : []));
  }

  dayOption(n: number): string {
    return this.optionDays(this.session!.options)[n - 1];
  }

  slotOption(n: number): Date {
    return this.optionSlots(this.session!.options)[n - 1];
  }

  lastOfferedDay(): string | undefined {
    return this.optionDays(this.session?.options ?? []).at(-1);
  }

  isoDate(at: Date): string {
    return DateTime.fromJSDate(at, { zone: this.tz }).toISODate()!;
  }

  // --- Oferta de dias e horários ---

  ctx(busy: { start: Date; end: Date }[]) {
    return { rules: this.rules, busy, now: this.now, timeZone: this.tz, minutes: this.minutes };
  }

  /** O tempo do atendimento: o do horário que se remarca, senão o do tratamento, senão o padrão das regras. */
  async lengthFor(): Promise<number> {
    const id = this.session?.flow === "reschedule" ? this.session.appointmentId : null;
    const appt = id ? await this.store.findAppointment(id) : null;
    if (appt) return Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000);
    return this.catalog.minutes(this.carry.service ?? ASSESSMENT) ?? this.rules.slotMinutes;
  }

  // --- Agendamento existente (FR-018a: o Google Agenda é a fonte da verdade) ---

  /** Confere o evento no Google: apagado conta como cancelado, movido passa a valer no horário novo. */
  sync(appt: AppointmentRow | null): Promise<AppointmentRow | null> {
    return syncAppointment(
      { calendar: this.calendar, store: this.store, inbox: this.inbox, reminderLeadMinutes: this.reminderLeadMinutes },
      appt,
      { now: this.now, timeZone: this.tz, conversationId: this.conversation.id },
    );
  }

  tooLate(appt: AppointmentRow): boolean {
    return appt.startsAt.getTime() - this.now.getTime() < this.rules.cancelNoticeMinutes * 60_000;
  }
}
