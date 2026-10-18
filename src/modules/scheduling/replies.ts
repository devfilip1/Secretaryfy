import { UNAVAILABLE_MESSAGE } from "../whatsapp/handle-message.js";
import { formatDay, formatDayTime, formatPtBr, formatTime } from "./dates.js";

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

  confirmBooking(start: Date, slotMinutes: number, name: string, tz: string) {
    return `Please confirm your appointment:\n📅 ${formatDayTime(start, tz)} (${slotMinutes} min)\n👤 ${name}\nReply YES to confirm or NO to choose another time.`;
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
};

/** Registros no histórico do painel, em português (origin = system). */
export const systemNotes = {
  booked: (start: Date, minutes: number, tz: string) => `📅 Agendado pelo assistente: ${formatPtBr(start, tz)} (${minutes} min)`,
  rescheduled: (from: Date, to: Date, tz: string) =>
    `📅 Remarcado pelo assistente: ${formatPtBr(from, tz).replace(" às ", " ")} → ${formatPtBr(to, tz).replace(" às ", " ")}`,
  cancelledByCustomer: (start: Date, tz: string) => `📅 Cancelado pelo cliente: ${formatPtBr(start, tz)}`,
  cancelledInCalendar: (start: Date, tz: string) => `📅 Cancelado na agenda: ${formatPtBr(start, tz)}`,
  handoff: () => "⚠️ O assistente não entendeu o cliente e foi pausado nesta conversa",
};
