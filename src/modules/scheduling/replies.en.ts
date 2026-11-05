import { fixedTextsFor } from "../antiban/texts.js";
import { formatDayLong, formatTime, formatWhen, weekdayName } from "./dates.js";
import { ASSESSMENT, SERVICES, serviceLabel } from "./services.js";
import type { Replies } from "./replies.js";

const bullets = (lines: string[]) => lines.map((line) => `• ${line}`).join("\n");

const hoursText = (minutes: number) => {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const h = minutes / 60;
  return h === 1 ? "1 hour" : `${h} hours`;
};

/** Textos em inglês, com o nome da clínica dado pela configuração (CLINIC_NAME). */
export function createEnglishReplies(clinicName: string, assistantName?: string): Replies {
  const r: Replies = {
    offerDays(days: string[], tz: string, intro = "Sure! These days have openings:") {
      return `${intro}\n${bullets(days.map((d) => formatDayLong(d, tz)))}\nWhich one works best for you? Or tell me another date.`;
    },

    offerSlots(date: string, slots: Date[], tz: string, hasMore: boolean) {
      const tail = hasMore ? "I can show more times or another day if you like." : "I can also check another day if you like.";
      return `On ${formatDayLong(date, tz)} I have these times:\n${bullets(slots.map((s) => formatTime(s, tz)))}\nWhich one would you like? ${tail}`;
    },

    closedDay(date: string, closest: string[], tz: string) {
      return r.offerDays(closest, tz, `We're closed on ${weekdayName(date, tz)}s. The closest days with openings are:`);
    },

    dayFull(date: string, closest: string[], tz: string) {
      return r.offerDays(closest, tz, `Sorry, there are no openings on ${formatDayLong(date, tz)}. The closest days with openings are:`);
    },

    tooFar(maxDaysAhead: number, lastDate: string, closest: string[], tz: string) {
      return r.offerDays(
        closest,
        tz,
        `I can only book up to ${maxDaysAhead} days ahead, until ${formatDayLong(lastDate, tz)}. Here are the closest days:`,
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
      return `Which service is this appointment for?\n${bullets(lines)}\nJust tell me which one.`;
    },

    confirmBooking(start: Date, slotMinutes: number, name: string, service: string, tz: string) {
      return [
        "Please confirm your appointment:",
        `📅 ${formatWhen(start, tz)} (${slotMinutes} min)`,
        `👤 ${name}`,
        `🦷 ${serviceLabel(service)}`,
        "Reply YES to confirm, NO to choose another time, or tell me another service.",
      ].join("\n");
    },

    booked(start: Date, tz: string) {
      return `You're booked! 📅 ${formatWhen(start, tz)}. See you at ${clinicName}.`;
    },

    slotTaken(date: string, slots: Date[], tz: string) {
      const list = bullets(slots.map((s) => formatTime(s, tz)));
      return `Sorry, that time was just taken. The closest available times on ${formatDayLong(date, tz)} are:\n${list}\nWhich one would you like? I can also check another day.`;
    },

    alreadyBooked(start: Date, tz: string) {
      return `You already have an appointment on ${formatWhen(start, tz)}. Would you like to reschedule it? (YES/NO)`;
    },

    myAppointment(start: Date, tz: string) {
      return `Your appointment is on ${formatWhen(start, tz)}.`;
    },

    noAppointment() {
      return "I couldn't find an appointment for this number.";
    },

    confirmCancel(start: Date, tz: string) {
      return `Cancel your appointment on ${formatWhen(start, tz)}? (YES/NO)`;
    },

    cancelled(start: Date, tz: string) {
      return `Your appointment on ${formatWhen(start, tz)} was cancelled.`;
    },

    keptAppointment(start: Date, tz: string) {
      return `Okay, your appointment on ${formatWhen(start, tz)} stays as it is.`;
    },

    confirmReschedule(from: Date, to: Date, tz: string) {
      return `Move your appointment from ${formatWhen(from, tz)} to ${formatWhen(to, tz)}? (YES/NO)`;
    },

    rescheduled(start: Date, tz: string) {
      return `Done! Your appointment is now on ${formatWhen(start, tz)}.`;
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
        `My pleasure! See you soon at ${clinicName}.`,
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
      return fixedTextsFor("en").unavailable[0];
    },

    /**
     * Lembrete 24 h antes (specs/006, contracts/conversation.md): três variações, para nunca repetir o último texto
     * enviado à conversa. O agendador escolhe com gate.pickVariant.
     */
    reminder(start: Date, service: string, name: string | null, tz: string): string[] {
      const when = formatWhen(start, tz);
      const label = serviceLabel(service);
      return [
        `Hi${name ? ` ${name}` : ""}! Just a reminder of your appointment at ${clinicName} on ${when} (${label}). Please reply YES to confirm.`,
        `Hello${name ? ` ${name}` : ""}, your ${label} appointment at ${clinicName} is on ${when}. Can you confirm you'll be there? Reply YES to confirm.`,
        `Hi${name ? ` ${name}` : ""}, this is ${clinicName} reminding you of your appointment on ${when} for ${label}. Reply YES to confirm, or tell me if you need to reschedule.`,
      ];
    },

    /** O cliente respondeu YES ao lembrete. */
    reminderConfirmed(start: Date, name: string | null, tz: string) {
      return `Thank you${name ? `, ${name}` : ""}! Your appointment on ${formatWhen(start, tz)} is confirmed. See you at ${clinicName}.`;
    },

    daysIntro() {
      return "These days have openings:";
    },

    noMoreOpeningsToday() {
      return "There are no more openings that day. Other days with openings:";
    },

    yesOrNo() {
      return "Please reply YES or NO.";
    },

    greeting(hour: number) {
      const salutation = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      return assistantName ? `${salutation}! This is ${assistantName} from ${clinicName}.` : `${salutation}! You've reached ${clinicName}.`;
    },

    myName() {
      return assistantName ? `I'm ${assistantName} from ${clinicName}. How can I help?` : `This is ${clinicName}. How can I help?`;
    },

    howCanIHelp() {
      return "How can I help you?";
    },
  };
  return r;
}
