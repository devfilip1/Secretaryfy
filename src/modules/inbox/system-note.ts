import { formatDayTime } from "../scheduling/dates.js";

/**
 * Registro do Secretaryfy no histórico do painel (origin = system), tipado. O painel traduz o `kind` com os dados; o
 * texto em inglês (`systemNoteText`) é o fallback para linhas antigas, a prévia e os logs. Instantes em ISO, fuso da
 * clínica em cada nota com data (o painel não precisa de outra consulta).
 */
export type SystemNote =
  | { kind: "booked"; start: string; minutes: number; service: string; timeZone: string }
  | { kind: "booked_from_panel"; start: string; minutes: number; service: string; timeZone: string }
  | { kind: "rescheduled"; from: string; to: string; timeZone: string }
  | { kind: "cancelled_by_customer"; start: string; timeZone: string }
  | { kind: "cancelled_by_staff"; start: string; timeZone: string }
  | { kind: "cancelled_in_calendar"; start: string; timeZone: string }
  | { kind: "needs_staff"; urgent: boolean }
  | { kind: "handoff" }
  | { kind: "reminder_sent"; start: string; timeZone: string }
  /** `reason` é o código do motivo (ver REMINDER_REASONS), não o texto */
  | { kind: "reminder_not_sent"; start: string; reason: string; timeZone: string }
  | { kind: "confirmed_by_customer"; start: string; timeZone: string }
  | { kind: "confirmed_by_operator"; start: string; timeZone: string }
  /** Envio bloqueado pela proteção do número; `reason` é o motivo do bloqueio (ver PROTECTION_REASONS) */
  | { kind: "protection_blocked"; reason: ProtectionReason }
  | { kind: "opted_out" }
  | { kind: "opted_in" }
  | { kind: "reactivated_by_operator" };

export type ProtectionReason = "loop" | "daily_conversations" | "rate_limited" | "paused";

/** Motivo do lembrete que não saiu, em inglês, para o texto de fallback. */
export const REMINDER_REASONS: Record<string, string> = {
  outside_window: "the customer has not written in over 24 h",
  disconnected: "WhatsApp is disconnected",
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

const PROTECTION_TEXTS: Record<ProtectionReason, string> = {
  loop: "Possibly talking to another bot: the assistant was paused",
  daily_conversations: "Daily conversation limit reached: the assistant did not reply",
  rate_limited: "The reply waited too long in the queue and was not sent",
  paused: "Automatic sending paused by protection: the assistant did not reply",
};

/** O texto em inglês de cada registro: o mesmo de antes da tipagem, para linhas antigas e logs. */
export function systemNoteText(note: SystemNote): string {
  switch (note.kind) {
    case "booked":
      return `Booked by the assistant: ${when(note.start, note.timeZone)} (${note.minutes} min), ${note.service}`;
    case "booked_from_panel":
      return `Booked from the panel: ${when(note.start, note.timeZone)} (${note.minutes} min), ${note.service}`;
    case "rescheduled":
      return `Rescheduled by the assistant: ${when(note.from, note.timeZone)} → ${when(note.to, note.timeZone)}`;
    case "cancelled_by_customer":
      return `Cancelled by the customer: ${when(note.start, note.timeZone)}`;
    case "cancelled_by_staff":
      return `Cancelled from the panel: ${when(note.start, note.timeZone)}`;
    case "cancelled_in_calendar":
      return `Cancelled in the calendar: ${when(note.start, note.timeZone)}`;
    case "needs_staff":
      return note.urgent
        ? "Urgent: the customer needs the team (pain, swelling or another health problem). The assistant was paused in this conversation"
        : "The customer needs someone from the team (a person, a discount or special condition, a complaint or medical advice). The assistant was paused in this conversation";
    case "handoff":
      return "The assistant did not understand the customer and was paused in this conversation";
    case "reminder_sent":
      return `Reminder sent for ${when(note.start, note.timeZone)}`;
    case "reminder_not_sent":
      return `Reminder not sent for ${when(note.start, note.timeZone)}: ${REMINDER_REASONS[note.reason] ?? note.reason}`;
    case "confirmed_by_customer":
      return `Appointment confirmed by the customer: ${when(note.start, note.timeZone)}`;
    case "confirmed_by_operator":
      return `Appointment confirmed by the operator: ${when(note.start, note.timeZone)}`;
    case "protection_blocked":
      return PROTECTION_TEXTS[note.reason];
    case "opted_out":
      return "The customer asked not to receive messages";
    case "opted_in":
      return "The customer accepts messages again";
    case "reactivated_by_operator":
      return "Messages reactivated by the operator";
  }
}

const when = (iso: string, timeZone: string) => formatDayTime(new Date(iso), timeZone);
