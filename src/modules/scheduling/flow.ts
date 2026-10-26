import { DateTime } from "luxon";
import type { AppointmentRow, ConversationRow, SchedulingSessionRow, SessionOption } from "../../db/schema.js";
import type { CustomerRepository } from "../customers/repository.js";
import type { ConnectionStore } from "../google/connection.js";
import { CalendarUnavailable, type CalendarGateway } from "../google/gateway.js";
import type { InboxService } from "../inbox/service.js";
import { initialReminderStatus } from "../reminders/status.js";
import { availableDays, bookingWindow, isSlotAvailable, slotsForDay } from "./availability.js";
import { createBooking, DEFAULT_REMINDER_LEAD_MINUTES, syncAppointment, type Booking } from "./booking.js";
import type { Interpretation } from "./interpret.js";
import { replies, systemNotes } from "./replies.js";
import { ASSESSMENT, SERVICES } from "./services.js";
import { withCalendarLock } from "./lock.js";
import type { Rules, RulesStore } from "./rules.js";
import type { SchedulingStore, SessionDraft } from "./sessions.js";

/** Até 6 dias ou horários por resposta (FR-013). */
const PAGE = 6;
/** Na segunda resposta não entendida seguida, o assistente passa a conversa para o operador (FR-024a). */
const MAX_MISUNDERSTOOD = 2;

export interface FlowResult {
  reply: string;
  /** O assistente desistiu e pausou a conversa: a resposta deve ser enviada mesmo assim */
  handoff?: boolean;
}

interface Deps {
  calendar: CalendarGateway;
  connection: Pick<ConnectionStore, "getForUse">;
  rules: Pick<RulesStore, "get">;
  store: SchedulingStore;
  inbox: Pick<InboxService, "recordSystem" | "flagNeedsAttention" | "setCustomerName">;
  /** Cadastro de clientes: quem confirma um horário entra nele (specs/005, US3) */
  customers: Pick<CustomerRepository, "upsert">;
  log?: { error: (obj: object, msg: string) => void };
  now?: () => Date;
  /** Antecedência do lembrete, para o status inicial e o de um horário remarcado (specs/006) */
  reminderLeadMinutes?: number;
}

/** Máquina de estados do agendamento (data-model.md). O modelo só interpreta; quem decide e escreve é o código. */
export function createSchedulingFlow({
  calendar,
  connection,
  rules: rulesStore,
  store,
  inbox,
  customers,
  log = console,
  now: clock = () => new Date(),
  reminderLeadMinutes = DEFAULT_REMINDER_LEAD_MINUTES,
}: Deps) {
  // A marcação em si é a mesma do painel (specs/006 research.md R2)
  const booking = createBooking({ calendar, connection, rules: rulesStore, store, inbox, customers, log, now: clock, reminderLeadMinutes });
  return {
    async handle({
      conversation,
      interpretation,
      session,
      knownName = null,
      mentionedService = null,
    }: {
      conversation: ConversationRow;
      interpretation: Interpretation;
      session: SchedulingSessionRow | null;
      /** O nome que o cliente disse ou o do cadastro; nunca o do perfil do WhatsApp (specs/005 FR-007) */
      knownName?: string | null;
      /** O tratamento citado por último na conversa (specs/005 FR-010) */
      mentionedService?: string | null;
    }): Promise<FlowResult> {
      const conn = await connection.getForUse();
      if (!conn || conn.status !== "connected") {
        await store.clearSession(conversation.id);
        return { reply: replies.calendarUnavailable() };
      }
      const run = new Run({
        calendar,
        store,
        inbox,
        booking,
        reminderLeadMinutes,
        conversation,
        session,
        knownName,
        mentionedService,
        now: clock(),
        tz: conn.timeZone,
        calendarId: conn.calendarId,
        rules: await rulesStore.get(),
      });
      try {
        return await run.dispatch(interpretation);
      } catch (err) {
        // Google fora do ar ou sem acesso: nada fica marcado pela metade (FR-022)
        if (err instanceof CalendarUnavailable) return { reply: replies.calendarUnavailable() };
        throw err;
      }
    },
  };
}

export type SchedulingFlow = ReturnType<typeof createSchedulingFlow>;

/** Uma mensagem do cliente sendo tratada: os dados da conversa e as ações possíveis. */
class Run {
  private readonly calendar: CalendarGateway;
  private readonly store: SchedulingStore;
  private readonly inbox: Deps["inbox"];
  private readonly booking: Booking;
  private readonly reminderLeadMinutes: number;
  private readonly conversation: ConversationRow;
  private readonly session: SchedulingSessionRow | null;
  private readonly knownName: string | null;
  private readonly now: Date;
  private readonly tz: string;
  private readonly calendarId: string;
  private readonly rules: Rules;
  private readonly window: ReturnType<typeof bookingWindow>;
  /** Fluxo, agendamento, nome e serviço que passam de uma etapa para a outra */
  private carry: Pick<SessionDraft, "flow" | "appointmentId" | "customerName" | "service">;

  constructor(v: {
    calendar: CalendarGateway;
    store: SchedulingStore;
    inbox: Deps["inbox"];
    booking: Booking;
    reminderLeadMinutes: number;
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
    this.conversation = v.conversation;
    this.session = v.session;
    this.knownName = v.knownName;
    this.now = v.now;
    this.tz = v.tz;
    this.calendarId = v.calendarId;
    this.rules = v.rules;
    this.window = bookingWindow({ rules: v.rules, now: v.now, timeZone: v.tz });
    this.carry = {
      flow: v.session?.flow ?? "book",
      appointmentId: v.session?.appointmentId ?? null,
      customerName: v.session?.customerName ?? null,
      service: v.session?.service ?? v.mentionedService,
    };
  }

  async dispatch(i: Interpretation): Promise<FlowResult> {
    const s = this.session;

    if (i.intent === "stop") return this.finish(replies.stopped());
    if (i.tooFar && ["availability", "choose", "book"].includes(i.intent)) return this.tooFar();

    switch (i.intent) {
      case "book":
        return this.startBook(i.date);
      case "availability":
        return i.date ? this.offerDay(i.date) : this.offerDays();
      case "cancel":
        return this.startCancel();
      case "reschedule":
        return this.startReschedule();
      case "my_appointment": {
        const appt = await this.currentAppointment();
        return { reply: appt ? replies.myAppointment(appt.startsAt, this.tz) : replies.noAppointment() };
      }
    }

    switch (s?.step) {
      case "choose_day":
        if (i.intent === "choose" && i.option !== null) return this.offerDay(this.dayOption(i.option));
        if (i.intent === "choose" && i.date) return this.offerDay(i.date);
        if (i.intent === "more") return this.offerDays({ after: this.lastOfferedDay() });
        if (i.intent === "other_day") return this.offerDays();
        break;
      case "choose_slot":
        if (i.intent === "choose" && i.option !== null) return this.selectSlot(this.slotOption(i.option));
        if (i.intent === "choose" && i.date) return this.offerDay(i.date);
        if (i.intent === "more") return this.moreSlots();
        if (i.intent === "other_day") return this.offerDays();
        break;
      case "ask_name":
        if (i.intent === "give_name" && i.name) return this.nameGiven(s.selectedStart!, i.name);
        break;
      case "choose_service":
        if (i.intent === "choose_service" && i.service) return this.serviceChosen(i.service);
        break;
      case "confirm_booking":
        if (i.intent === "yes") return this.book();
        // Outro tratamento no resumo troca o serviço (FR-012)
        if (i.intent === "choose_service" && i.service) return this.serviceChosen(i.service);
        // "my name is …" no resumo corrige o nome (FR-007)
        if (i.intent === "give_name" && i.name) return this.nameGiven(s.selectedStart!, i.name);
        if (i.intent === "no") return this.offerDay(this.isoDate(s.selectedStart!));
        break;
      case "offer_reschedule":
        if (i.intent === "yes") return this.startReschedule();
        if (i.intent === "no") return this.keep();
        break;
      case "confirm_cancel":
        if (i.intent === "yes") return this.cancel();
        if (i.intent === "no") return this.keep();
        break;
      case "confirm_reschedule":
        if (i.intent === "yes") return this.move();
        if (i.intent === "no") return this.offerDays();
        break;
    }
    return this.misunderstood();
  }

  // --- Sessão ---

  private save(draft: Pick<SessionDraft, "step"> & Partial<Pick<SessionDraft, "options" | "selectedStart" | "customerName">>) {
    return this.store.saveSession({ conversationId: this.conversation.id, ...this.carry, ...draft }, this.now);
  }

  private async finish(reply: string): Promise<FlowResult> {
    await this.store.clearSession(this.conversation.id);
    return { reply };
  }

  private async misunderstood(): Promise<FlowResult> {
    const s = this.session;
    // Sem etapa em andamento não há pergunta a repetir nem contador
    if (!s) return { reply: replies.unclear("How can I help you?") };
    const count = s.misunderstoodCount + 1;
    if (count >= MAX_MISUNDERSTOOD) {
      await this.store.clearSession(this.conversation.id);
      await this.inbox.flagNeedsAttention(this.conversation.id);
      await this.inbox.recordSystem(this.conversation.id, systemNotes.handoff());
      return { reply: replies.handoff(), handoff: true };
    }
    await this.store.saveSession(
      {
        conversationId: s.conversationId,
        flow: s.flow,
        step: s.step,
        options: s.options,
        selectedStart: s.selectedStart,
        customerName: s.customerName,
        service: s.service,
        appointmentId: s.appointmentId,
        misunderstoodCount: count,
      },
      this.now,
    );
    return { reply: replies.unclear(this.repeatPrompt(s)) };
  }

  /** A pergunta da etapa, repetida depois de um "não entendi". */
  private repeatPrompt(s: SchedulingSessionRow): string {
    switch (s.step) {
      case "choose_day":
        return replies.offerDays(this.optionDays(s.options), this.tz, "These days have openings:");
      case "choose_slot": {
        const slots = this.optionSlots(s.options);
        return replies.offerSlots(this.isoDate(slots[0]), slots, this.tz, false);
      }
      case "ask_name":
        return replies.askName();
      case "choose_service":
        return replies.chooseService();
      default:
        return "Please reply YES or NO.";
    }
  }

  // --- Opções numeradas ---

  private optionDays(options: SessionOption[]) {
    return options.flatMap((o) => (o.kind === "day" ? [o.date] : []));
  }

  private optionSlots(options: SessionOption[]) {
    return options.flatMap((o) => (o.kind === "slot" ? [new Date(o.start)] : []));
  }

  private dayOption(n: number): string {
    return this.optionDays(this.session!.options)[n - 1];
  }

  private slotOption(n: number): Date {
    return this.optionSlots(this.session!.options)[n - 1];
  }

  private lastOfferedDay(): string | undefined {
    return this.optionDays(this.session?.options ?? []).at(-1);
  }

  private isoDate(at: Date): string {
    return DateTime.fromJSDate(at, { zone: this.tz }).toISODate()!;
  }

  // --- Oferta de dias e horários ---

  private ctx(busy: { start: Date; end: Date }[]) {
    return { rules: this.rules, busy, now: this.now, timeZone: this.tz };
  }

  /** Dias com vaga em toda a janela, numa consulta só à agenda. */
  private async daysWithOpenings(after?: string): Promise<string[]> {
    const busy = await this.calendar.busy(this.window.from, this.window.to);
    return availableDays({ ...this.ctx(busy), after });
  }

  private async slotsOn(date: string): Promise<Date[]> {
    const start = DateTime.fromISO(date, { zone: this.tz });
    const busy = await this.calendar.busy(start.toJSDate(), start.plus({ days: 1 }).toJSDate());
    return slotsForDay(date, this.ctx(busy));
  }

  private async saveDays(days: string[]) {
    await this.save({ step: "choose_day", options: days.map((date, i) => ({ n: i + 1, kind: "day" as const, date })) });
  }

  private async offerDays({ after }: { after?: string } = {}): Promise<FlowResult> {
    const days = (await this.daysWithOpenings(after)).slice(0, PAGE);
    if (days.length === 0) return this.finish(replies.noOpenings());
    await this.saveDays(days);
    return { reply: replies.offerDays(days, this.tz) };
  }

  /** Horários de um dia; sem vaga, os dias livres mais próximos (US2, cenário 3). */
  private async offerDay(date: string): Promise<FlowResult> {
    if (date > this.window.lastDate) return this.tooFar();
    const slots = await this.slotsOn(date);
    if (slots.length === 0) {
      const closest = await this.closestDays(date);
      if (closest.length === 0) return this.finish(replies.noOpenings());
      await this.saveDays(closest);
      return { reply: replies.dayFull(date, closest, this.tz) };
    }
    return this.offerSlots(date, slots);
  }

  /** Primeira página de horários do dia; "taken" quando o horário escolhido acabou de ser ocupado. */
  private async offerSlots(date: string, slots: Date[], kind: "offer" | "taken" = "offer"): Promise<FlowResult> {
    const page = slots.slice(0, PAGE);
    await this.save({ step: "choose_slot", options: page.map((s, i) => ({ n: i + 1, kind: "slot" as const, start: s.toISOString() })) });
    const reply =
      kind === "taken" ? replies.slotTaken(date, page, this.tz) : replies.offerSlots(date, page, this.tz, slots.length > PAGE);
    return { reply };
  }

  private async moreSlots(): Promise<FlowResult> {
    const last = this.optionSlots(this.session!.options).at(-1)!;
    const date = this.isoDate(last);
    const rest = (await this.slotsOn(date)).filter((s) => s > last);
    if (rest.length === 0) {
      const days = (await this.daysWithOpenings(date)).slice(0, PAGE);
      if (days.length === 0) return this.finish(replies.noOpenings());
      await this.saveDays(days);
      return { reply: replies.offerDays(days, this.tz, "There are no more openings that day. Other days with openings:") };
    }
    return this.offerSlots(date, rest);
  }

  private async closestDays(date: string): Promise<string[]> {
    const target = DateTime.fromISO(date, { zone: this.tz });
    const distance = (d: string) => Math.abs(DateTime.fromISO(d, { zone: this.tz }).diff(target, "days").days);
    return (await this.daysWithOpenings())
      .sort((a, b) => distance(a) - distance(b) || a.localeCompare(b))
      .slice(0, PAGE)
      .sort();
  }

  private async tooFar(): Promise<FlowResult> {
    const days = (await this.daysWithOpenings()).slice(0, PAGE);
    if (days.length === 0) return this.finish(replies.noOpenings());
    await this.saveDays(days);
    return { reply: replies.tooFar(this.rules.maxDaysAhead, this.window.lastDate, days, this.tz) };
  }

  // --- Marcar ---

  private async startBook(date: string | null): Promise<FlowResult> {
    const existing = await this.currentAppointment();
    if (existing) return this.offerReschedule(existing);
    this.carry = { flow: "book", appointmentId: null, customerName: this.carry.customerName };
    return date ? this.offerDay(date) : this.offerDays();
  }

  private async offerReschedule(appt: AppointmentRow): Promise<FlowResult> {
    this.carry = { ...this.carry, flow: "book", appointmentId: appt.id };
    await this.save({ step: "offer_reschedule" });
    return { reply: replies.alreadyBooked(appt.startsAt, this.tz) };
  }

  private async selectSlot(start: Date): Promise<FlowResult> {
    if (this.session?.flow === "reschedule") {
      const appt = this.session.appointmentId ? await this.store.findAppointment(this.session.appointmentId) : null;
      if (!appt) return this.finish(replies.noAppointment());
      await this.save({ step: "confirm_reschedule", selectedStart: start });
      return { reply: replies.confirmReschedule(appt.startsAt, start, this.tz) };
    }
    const name = this.session?.customerName ?? this.knownName;
    if (!name) {
      await this.save({ step: "ask_name", selectedStart: start });
      return { reply: replies.askName() };
    }
    return this.toSummary(start, name);
  }

  /** O cliente disse o nome no agendamento: vale também para a conversa (specs/005 FR-003). */
  private async nameGiven(start: Date, name: string): Promise<FlowResult> {
    await this.inbox.setCustomerName(this.conversation.id, name);
    return this.toSummary(start, name);
  }

  /** Com nome e horário: pergunta o serviço se ele ainda não veio da conversa, senão mostra o resumo (FR-011). */
  private async toSummary(start: Date, name: string): Promise<FlowResult> {
    if (this.carry.service) return this.confirmBooking(start, name);
    const options = SERVICES.map((s, i) => ({ n: i + 1, kind: "service" as const, service: s.name }));
    await this.save({ step: "choose_service", options, selectedStart: start, customerName: name });
    return { reply: replies.chooseService() };
  }

  private async serviceChosen(service: string): Promise<FlowResult> {
    const s = this.session!;
    this.carry = { ...this.carry, service };
    return this.confirmBooking(s.selectedStart!, s.customerName ?? this.knownName ?? "Cliente");
  }

  private async confirmBooking(start: Date, name: string): Promise<FlowResult> {
    await this.save({ step: "confirm_booking", selectedStart: start, customerName: name });
    return { reply: replies.confirmBooking(start, this.rules.slotMinutes, name, this.carry.service!, this.tz) };
  }

  /**
   * Cria o evento pelo mesmo motor do painel (specs/006 R2): dentro da trava, confere de novo a ocupação e a regra de um
   * horário por número (FR-015, FR-019).
   */
  private async book(): Promise<FlowResult> {
    const s = this.session!;
    const start = s.selectedStart!;
    // O resumo sempre tem o nome: ele vem de ask_name ou do nome conhecido
    const name = s.customerName ?? this.knownName ?? "Cliente";
    const service = s.service ?? ASSESSMENT;

    const result = await this.booking.bookSlot({
      phone: this.conversation.phone,
      name,
      service,
      start,
      origin: "assistant",
      conversationId: this.conversation.id,
    });
    switch (result.kind) {
      case "already_booked":
        return this.offerReschedule(result.appointment);
      case "slot_taken":
        return this.slotTaken(start);
      case "calendar_unavailable":
        throw new CalendarUnavailable("agenda desconectada durante a marcação");
      case "booked":
        await this.store.clearSession(this.conversation.id);
        return { reply: replies.booked(start, this.tz) };
    }
  }

  /** O horário foi tomado entre a oferta e o "sim": novas opções no mesmo dia, ou os dias mais próximos. */
  private async slotTaken(start: Date): Promise<FlowResult> {
    const date = this.isoDate(start);
    const slots = await this.slotsOn(date);
    if (slots.length > 0) return this.offerSlots(date, slots, "taken");
    return this.offerDay(date);
  }

  // --- Agendamento existente (FR-018a: o Google Agenda é a fonte da verdade) ---

  /** O próximo horário do telefone, venha ele desta conversa, de outra ou do painel (specs/006 R1). */
  private async currentAppointment(): Promise<AppointmentRow | null> {
    return this.sync(await this.store.findFutureBooked(this.conversation.phone, this.now));
  }

  private async refreshSessionAppointment(): Promise<AppointmentRow | null> {
    const id = this.session?.appointmentId;
    return this.sync(id ? await this.store.findAppointment(id) : null);
  }

  /** Confere o evento no Google: apagado conta como cancelado, movido passa a valer no horário novo. */
  private sync(appt: AppointmentRow | null): Promise<AppointmentRow | null> {
    return syncAppointment(
      { calendar: this.calendar, store: this.store, inbox: this.inbox, reminderLeadMinutes: this.reminderLeadMinutes },
      appt,
      { now: this.now, timeZone: this.tz, conversationId: this.conversation.id },
    );
  }

  private tooLate(appt: AppointmentRow): boolean {
    return appt.startsAt.getTime() - this.now.getTime() < this.rules.cancelNoticeMinutes * 60_000;
  }

  private async keep(): Promise<FlowResult> {
    const appt = await this.refreshSessionAppointment();
    return this.finish(appt ? replies.keptAppointment(appt.startsAt, this.tz) : replies.stopped());
  }

  // --- Cancelar (FR-026, FR-027) ---

  private async startCancel(): Promise<FlowResult> {
    const appt = await this.currentAppointment();
    if (!appt) return this.finish(replies.noAppointment());
    if (this.tooLate(appt)) return this.finish(replies.tooLateToChange(this.rules.cancelNoticeMinutes));
    this.carry = { ...this.carry, flow: "cancel", appointmentId: appt.id };
    await this.save({ step: "confirm_cancel" });
    return { reply: replies.confirmCancel(appt.startsAt, this.tz) };
  }

  private cancel(): Promise<FlowResult> {
    return withCalendarLock(async () => {
      const appt = await this.refreshSessionAppointment();
      if (!appt) return this.finish(replies.noAppointment());
      if (this.tooLate(appt)) return this.finish(replies.tooLateToChange(this.rules.cancelNoticeMinutes));
      await this.calendar.deleteEvent(appt.googleEventId);
      await this.store.markCancelled(appt.id, "customer");
      await this.inbox.recordSystem(this.conversation.id, systemNotes.cancelledByCustomer(appt.startsAt, this.tz));
      return this.finish(replies.cancelled(appt.startsAt, this.tz));
    });
  }

  // --- Remarcar ---

  private async startReschedule(): Promise<FlowResult> {
    const appt = this.session?.step === "offer_reschedule" ? await this.refreshSessionAppointment() : await this.currentAppointment();
    if (!appt) return this.finish(replies.noAppointment());
    if (this.tooLate(appt)) return this.finish(replies.tooLateToChange(this.rules.cancelNoticeMinutes));
    this.carry = { ...this.carry, flow: "reschedule", appointmentId: appt.id };
    return this.offerDays();
  }

  private move(): Promise<FlowResult> {
    const start = this.session!.selectedStart!;
    const end = new Date(start.getTime() + this.rules.slotMinutes * 60_000);

    return withCalendarLock(async () => {
      const appt = await this.refreshSessionAppointment();
      if (!appt) return this.finish(replies.noAppointment());
      if (this.tooLate(appt)) return this.finish(replies.tooLateToChange(this.rules.cancelNoticeMinutes));

      // O próprio horário atual não conta como ocupado
      const busy = (await this.calendar.busy(start, end)).filter(
        (b) => b.start.getTime() !== appt.startsAt.getTime() || b.end.getTime() !== appt.endsAt.getTime(),
      );
      if (!isSlotAvailable(start, this.ctx(busy))) return this.slotTaken(start);

      await this.calendar.moveEvent(appt.googleEventId, start, end);
      if (!(await this.store.updateTimes(appt.id, start, end, initialReminderStatus(start, this.now, this.reminderLeadMinutes)))) {
        await this.calendar.moveEvent(appt.googleEventId, appt.startsAt, appt.endsAt).catch(() => {});
        return this.slotTaken(start);
      }
      await this.inbox.recordSystem(this.conversation.id, systemNotes.rescheduled(appt.startsAt, start, this.tz));
      return this.finish(replies.rescheduled(start, this.tz));
    });
  }
}
