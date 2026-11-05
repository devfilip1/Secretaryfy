import { formatDayTime } from "./dates.js";
import { createEnglishReplies } from "./replies.en.js";
import { createPortugueseReplies } from "./replies.pt.js";

/**
 * Textos enviados ao cliente pelo WhatsApp, na língua da clínica (CLINIC_LANGUAGE, contracts/conversation.md). O modelo
 * nunca escreve estes textos: "booked" só sai daqui depois de o evento existir na agenda (FR-024).
 */
export interface Replies {
  offerDays(days: string[], tz: string, intro?: string): string;
  offerSlots(date: string, slots: Date[], tz: string, hasMore: boolean): string;
  dayFull(date: string, closest: string[], tz: string): string;
  /** O dia pedido é um dia em que a clínica não atende (regras semanais do painel) */
  closedDay(date: string, closest: string[], tz: string): string;
  tooFar(maxDaysAhead: number, lastDate: string, closest: string[], tz: string): string;
  noOpenings(): string;
  askName(): string;
  /** `name`: com o nome do cliente, a pergunta o chama pelo primeiro nome */
  chooseService(name?: string | null): string;
  confirmBooking(start: Date, slotMinutes: number, name: string, service: string, tz: string): string;
  booked(start: Date, tz: string, name?: string | null): string;
  slotTaken(date: string, slots: Date[], tz: string): string;
  alreadyBooked(start: Date, tz: string): string;
  myAppointment(start: Date, tz: string): string;
  noAppointment(): string;
  confirmCancel(start: Date, tz: string): string;
  cancelled(start: Date, tz: string): string;
  keptAppointment(start: Date, tz: string): string;
  confirmReschedule(from: Date, to: Date, tz: string): string;
  rescheduled(start: Date, tz: string): string;
  tooLateToChange(cancelNoticeMinutes: number): string;
  stopped(): string;
  askNameFollowUp(random?: () => number): string;
  nameReceived(name: string, random?: () => number): string;
  goodbye(random?: () => number, name?: string | null): string;
  unclear(repeat: string): string;
  handoff(): string;
  calendarUnavailable(): string;
  interpreterUnavailable(): string;
  reminder(start: Date, service: string, name: string | null, tz: string): string[];
  reminderConfirmed(start: Date, name: string | null, tz: string): string;
  /** Textos de apoio das etapas (a pergunta repetida, a lista de dias com vaga) */
  daysIntro(): string;
  noMoreOpeningsToday(): string;
  yesOrNo(): string;
  howCanIHelp(): string;
  /** Primeira mensagem da conversa: saudação pela hora do dia (0 a 23, no fuso da clínica) e quem fala */
  greeting(hour: number): string;
  /** Abre a resposta que repete, palavra por palavra, uma que já demos (a proteção descartaria o texto igual) */
  again(random?: () => number): string;
  /** O cliente perguntou o nome de quem atende */
  myName(): string;
}

/** O primeiro nome, para chamar o cliente como uma pessoa chamaria. */
export const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

/** Os textos na língua e com o nome da clínica dados (CLINIC_LANGUAGE, CLINIC_NAME). */
export function createReplies({
  language,
  clinicName,
  assistantName,
}: {
  language: "en" | "pt";
  clinicName: string;
  assistantName?: string;
}): Replies {
  return language === "pt" ? createPortugueseReplies(clinicName, assistantName) : createEnglishReplies(clinicName, assistantName);
}

/** Os textos em inglês da DentalSafe: o padrão de quem não passa as configurações. */
export const replies: Replies = createReplies({ language: "en", clinicName: "DentalSafe" });

/** Registros no histórico do painel, em inglês como o resto do painel (origin = system). */
export const systemNotes = {
  booked: (start: Date, minutes: number, tz: string, service: string) =>
    `📅 Booked by the assistant: ${formatDayTime(start, tz)} (${minutes} min) — ${service}`,
  bookedFromPanel: (start: Date, minutes: number, tz: string, service: string) =>
    `📅 Booked from the panel: ${formatDayTime(start, tz)} (${minutes} min) — ${service}`,
  rescheduled: (from: Date, to: Date, tz: string) =>
    `📅 Rescheduled by the assistant: ${formatDayTime(from, tz)} → ${formatDayTime(to, tz)}`,
  cancelledByCustomer: (start: Date, tz: string) => `📅 Cancelled by the customer: ${formatDayTime(start, tz)}`,
  cancelledInCalendar: (start: Date, tz: string) => `📅 Cancelled in the calendar: ${formatDayTime(start, tz)}`,
  handoff: () => "⚠️ The assistant did not understand the customer and was paused in this conversation",
  reminderSent: (start: Date, tz: string) => `🔔 Reminder sent for ${formatDayTime(start, tz)}`,
  reminderNotSent: (start: Date, reason: string, tz: string) => `🔔 Reminder not sent for ${formatDayTime(start, tz)}: ${reason}`,
  confirmedByCustomer: (start: Date, tz: string) => `✅ Appointment confirmed by the customer: ${formatDayTime(start, tz)}`,
  confirmedByOperator: (start: Date, tz: string) => `✅ Appointment confirmed by the operator: ${formatDayTime(start, tz)}`,
};

/** Por que o lembrete não saiu, no histórico do painel (os mesmos textos dos bloqueios da proteção, specs/004). */
export const REMINDER_REASONS: Record<string, string> = {
  outside_window: "the customer has not written in over 24 h",
  no_conversation: "no WhatsApp conversation with this number",
  opted_out: "the customer asked not to receive messages",
  paused: "automatic sending paused by protection",
  daily_conversations: "daily conversation limit reached",
  unanswered: "too many messages in a row without a customer reply",
  loop: "possibly talking to another bot",
  duplicate: "repeated text",
  rate_limited: "waited too long in the queue",
  superseded: "the operator replied first",
  restart: "server restarted before sending",
  failed: "WhatsApp send failed",
  blocked: "blocked by number protection",
  too_late: "less than 2 hours before the appointment",
};

export const reminderReasonText = (reason: string | null) => (reason && REMINDER_REASONS[reason]) ?? reason ?? "unknown reason";
