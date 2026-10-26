import { UNAVAILABLE_MESSAGE } from "../whatsapp/handle-message.js";
import { formatDay, formatDayTime, formatTime } from "./dates.js";
import { ASSESSMENT, SERVICES, serviceLabel } from "./services.js";

/**
 * Textos enviados ao cliente pelo WhatsApp, em inglês (contracts/conversation.md). O modelo nunca escreve estes textos:
 * "booked" só sai daqui depois de o evento existir na agenda (FR-024).
 */

const numbered = (lines: string[]) => lines.map((line, i) => `${i + 1}. ${line}`).join("\n");

const hoursText = (minutes: number) => {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const h = minutes / 60;
  return h === 1 ? "1 hour" : `${h} hours`;
};

export const replies = {
  offerDays(days: string[], tz: string, intro = "Sure! These days have openings:") {
    return `${intro}\n${numbered(days.map((d) => formatDay(d, tz)))}\nReply with the number of the day, or tell me another date.`;
  },

  offerSlots(date: string, slots: Date[], tz: string, hasMore: boolean) {
    const tail = hasMore ? 'Say "more" for more options or "other day" for another date.' : 'Say "other day" for another date.';
    return `Available times on ${formatDay(date, tz)}:\n${numbered(slots.map((s) => formatTime(s, tz)))}\nReply with the number of the time. ${tail}`;
  },

  dayFull(date: string, closest: string[], tz: string) {
    return replies.offerDays(closest, tz, `Sorry, there are no openings on ${formatDay(date, tz)}. The closest days with openings are:`);
  },

  tooFar(maxDaysAhead: number, lastDate: string, closest: string[], tz: string) {
    return replies.offerDays(
      closest,
      tz,
      `I can only book up to ${maxDaysAhead} days ahead, until ${formatDay(lastDate, tz)}. Here are the closest days:`,
    );
  },

  noOpenings() {
    return "Sorry, there are no openings in the coming days. Please contact the clinic directly.";
  },

  askName() {
    return "What name should I put on the appointment?";
  },

  /** Lista numerada dos serviços (specs/005, etapa choose_service). */
  chooseService() {
    const lines = SERVICES.map((s) => (s.name === ASSESSMENT ? "Not sure — general assessment" : s.name));
    return `Which service is this appointment for?\n${numbered(lines)}\nReply with the number or the name of the service.`;
  },

  confirmBooking(start: Date, slotMinutes: number, name: string, service: string, tz: string) {
    return [
      "Please confirm your appointment:",
      `📅 ${formatDayTime(start, tz)} (${slotMinutes} min)`,
      `👤 ${name}`,
      `🦷 ${serviceLabel(service)}`,
      "Reply YES to confirm, NO to choose another time, or tell me another service.",
    ].join("\n");
  },

  booked(start: Date, tz: string) {
    return `You're booked! 📅 ${formatDayTime(start, tz)}. See you at DentalSafe.`;
  },

  slotTaken(date: string, slots: Date[], tz: string) {
    const list = numbered(slots.map((s) => formatTime(s, tz)));
    return `Sorry, that time was just taken. The closest available times on ${formatDay(date, tz)} are:\n${list}\nReply with the number of the time, or say "other day".`;
  },

  alreadyBooked(start: Date, tz: string) {
    return `You already have an appointment on ${formatDayTime(start, tz)}. Would you like to reschedule it? (YES/NO)`;
  },

  myAppointment(start: Date, tz: string) {
    return `Your appointment is on ${formatDayTime(start, tz)}.`;
  },

  noAppointment() {
    return "I couldn't find an appointment for this number.";
  },

  confirmCancel(start: Date, tz: string) {
    return `Cancel your appointment on ${formatDayTime(start, tz)}? (YES/NO)`;
  },

  cancelled(start: Date, tz: string) {
    return `Your appointment on ${formatDayTime(start, tz)} was cancelled.`;
  },

  keptAppointment(start: Date, tz: string) {
    return `Okay, your appointment on ${formatDayTime(start, tz)} stays as it is.`;
  },

  confirmReschedule(from: Date, to: Date, tz: string) {
    return `Move your appointment from ${formatDayTime(from, tz)} to ${formatDayTime(to, tz)}? (YES/NO)`;
  },

  rescheduled(start: Date, tz: string) {
    return `Done! Your appointment is now on ${formatDayTime(start, tz)}.`;
  },

  tooLateToChange(cancelNoticeMinutes: number) {
    return `Your appointment is in less than ${hoursText(cancelNoticeMinutes)}, so I can't change it here. Please contact the clinic directly.`;
  },

  stopped() {
    return "No problem. Let me know if you'd like to book later.";
  },

  /** Última mensagem da primeira resposta a quem ainda não disse o nome (specs/005, contracts/conversation.md). */
  askNameFollowUp(random: () => number = Math.random) {
    const options = [
      "By the way, may I have your name?",
      "By the way, what's your name?",
      "Before I forget, may I have your name?",
    ];
    return options[Math.floor(random() * options.length)];
  },

  /** O cliente disse o nome, sem pergunta junto. */
  nameReceived(name: string, random: () => number = Math.random) {
    const options = [`Nice to meet you, ${name}! How can I help you?`, `Thanks, ${name}! How can I help you today?`];
    return options[Math.floor(random() * options.length)];
  },

  /** O cliente agradeceu ou se despediu: sem convite para agendar, só a despedida. */
  goodbye(random: () => number = Math.random) {
    const options = [
      "You're welcome! Have a great day 😊",
      "Anytime! Take care 😊",
      "My pleasure! See you soon at DentalSafe.",
      "Glad I could help! Have a nice day.",
    ];
    return options[Math.floor(random() * options.length)];
  },

  unclear(repeat: string) {
    return `Sorry, I didn't get that. ${repeat}`;
  },

  handoff() {
    return "Sorry, I'm having trouble understanding. Someone from our team will continue with you here shortly.";
  },

  calendarUnavailable() {
    return "Sorry, I can't book appointments right now. Please try again later or contact the clinic.";
  },

  interpreterUnavailable() {
    return UNAVAILABLE_MESSAGE;
  },

  /**
   * Lembrete 24 h antes (specs/006, contracts/conversation.md): três variações, para nunca repetir o último texto
   * enviado à conversa. O agendador escolhe com gate.pickVariant.
   */
  reminder(start: Date, service: string, name: string | null, tz: string): string[] {
    const when = formatDayTime(start, tz);
    const label = serviceLabel(service);
    return [
      `Hi${name ? ` ${name}` : ""}! Just a reminder of your appointment at DentalSafe on ${when} (${label}). Please reply YES to confirm.`,
      `Hello${name ? ` ${name}` : ""}, your ${label} appointment at DentalSafe is on ${when}. Can you confirm you'll be there? Reply YES to confirm.`,
      `Hi${name ? ` ${name}` : ""}, this is DentalSafe reminding you of your appointment on ${when} for ${label}. Reply YES to confirm, or tell me if you need to reschedule.`,
    ];
  },

  /** O cliente respondeu YES ao lembrete. */
  reminderConfirmed(start: Date, name: string | null, tz: string) {
    return `Thank you${name ? `, ${name}` : ""}! Your appointment on ${formatDayTime(start, tz)} is confirmed. See you at DentalSafe.`;
  },
};

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
