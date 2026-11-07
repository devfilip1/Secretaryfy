import { fixedTextsFor } from "../antiban/texts.js";
import { Info } from "luxon";
import { formatDayLong, formatTime, formatWhen } from "./dates.js";
import type { ClinicContext } from "../clinic/context.js";
import { ASSESSMENT, type ServiceCatalog } from "./catalog.js";
import { dayPeriod, firstName, joinList, type Replies } from "./replies.js";

const bullets = (lines: string[]) => lines.map((line) => `• ${line}`).join("\n");

const hoursText = (minutes: number) => {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const h = minutes / 60;
  return h === 1 ? "1 hour" : `${h} hours`;
};

/** Textos em inglês, com o nome da clínica dado pela configuração (CLINIC_NAME). */
export function createEnglishReplies({ clinic, catalog }: { clinic: Pick<ClinicContext, "name" | "assistantName">; catalog: ServiceCatalog }): Replies {
  const r: Replies = {
    offerDays(days: string[], tz: string, intro = "Sure! These days have openings:") {
      return `${intro}\n${bullets(days.map((d) => formatDayLong(d, tz)))}\nWhich one works best for you? Or tell me another date.`;
    },

    offerSlots(date: string, slots: Date[], tz: string, hasMore: boolean) {
      const tail = hasMore ? "I can show more times or another day if you like." : "I can also check another day if you like.";
      return `On ${formatDayLong(date, tz)} I have these times:\n${bullets(slots.map((s) => formatTime(s, tz)))}\nWhich one would you like? ${tail}`;
    },

    slotNotOffered(date: string, slots: Date[], tz: string) {
      return `Unfortunately we do not have that time! Would another one work for you on ${formatDayLong(date, tz)}?
${bullets(slots.map((s) => formatTime(s, tz)))}
I can also check another day if you like.`;
    },

    closedDay(closedWeekdays: number[], closest: string[], tz: string) {
      const names = closedWeekdays.map((d) => `${Info.weekdays("long", { locale: "en-US" })[d - 1]}s`);
      return r.offerDays(closest, tz, `We're closed on ${joinList(names, "and")}. The closest days with openings are:`);
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
    chooseService(name?: string | null) {
      const who = firstName(name);
      const lines = catalog.list().map((s) => (s.name === ASSESSMENT ? "Not sure — general assessment" : s.label));
      return `${who ? `${who}, which` : "Which"} service is this appointment for?\n${bullets(lines)}\nJust tell me which one.`;
    },

    confirmBooking(start: Date, slotMinutes: number, name: string, service: string, tz: string) {
      return [
        "Just to confirm:",
        `📅 ${formatWhen(start, tz)} (${slotMinutes} min)`,
        `👤 ${name}`,
        `🦷 ${catalog.label(service)}`,
        "Shall I confirm? If anything is wrong, like the name, the time or the service, just tell me.",
      ].join("\n");
    },

    booked(start: Date, tz: string, name?: string | null) {
      const who = firstName(name);
      return `You're booked${who ? `, ${who}` : ""}! 📅 ${formatWhen(start, tz)}. See you at ${clinic.name}.`;
    },

    slotTaken(date: string, slots: Date[], tz: string) {
      const list = bullets(slots.map((s) => formatTime(s, tz)));
      return `Sorry, that time was just taken. The closest available times on ${formatDayLong(date, tz)} are:\n${list}\nWhich one would you like? I can also check another day.`;
    },

    alreadyBooked(start: Date, tz: string) {
      return `You already have an appointment on ${formatWhen(start, tz)}. Would you like to reschedule it?`;
    },

    myAppointment(start: Date, tz: string) {
      return `Your appointment is on ${formatWhen(start, tz)}.`;
    },

    noAppointment() {
      return "I couldn't find an appointment for this number.";
    },

    confirmCancel(start: Date, tz: string) {
      return `Do you really want to cancel your appointment on ${formatWhen(start, tz)}?`;
    },

    cancelled(start: Date, tz: string) {
      return `Your appointment on ${formatWhen(start, tz)} was cancelled.`;
    },

    keptAppointment(start: Date, tz: string) {
      return `Okay, your appointment on ${formatWhen(start, tz)} stays as it is.`;
    },

    confirmReschedule(from: Date, to: Date, tz: string) {
      return `Shall I move your appointment from ${formatWhen(from, tz)} to ${formatWhen(to, tz)}?`;
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
      const who = firstName(name);
      const options = [`Nice to meet you, ${who}! How can I help you?`, `Thanks, ${who}! How can I help you today?`];
      return options[Math.floor(random() * options.length)];
    },

    /** O cliente agradeceu ou se despediu: sem convite para agendar, só a despedida. */
    goodbye(random: () => number = Math.random, name?: string | null) {
      const who = firstName(name);
      const options = [
        `You're welcome${who ? `, ${who}` : ""}! Have a great day 😊`,
        `Anytime${who ? `, ${who}` : ""}! Take care 😊`,
        `My pleasure! See you soon at ${clinic.name}.`,
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
      const label = catalog.label(service);
      return [
        `Hi${name ? ` ${name}` : ""}! Just a reminder of your appointment at ${clinic.name} on ${when} (${label}). Can you confirm?`,
        `Hello${name ? ` ${name}` : ""}, your ${label} appointment at ${clinic.name} is on ${when}. Can you confirm you'll be there?`,
        `Hi${name ? ` ${name}` : ""}, this is ${clinic.name} reminding you of your appointment on ${when} for ${label}. Can you confirm? Or tell me if you need to reschedule.`,
      ];
    },

    /** O cliente respondeu YES ao lembrete. */
    reminderConfirmed(start: Date, name: string | null, tz: string) {
      return `Thank you${name ? `, ${name}` : ""}! Your appointment on ${formatWhen(start, tz)} is confirmed. See you at ${clinic.name}.`;
    },

    daysIntro() {
      return "These days have openings:";
    },

    noMoreOpeningsToday() {
      return "There are no more openings that day. Other days with openings:";
    },

    yesOrNo() {
      return "Could you tell me yes or no?";
    },

    salutation(hour: number) {
      return `${{ morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" }[dayPeriod(hour)]}!`;
    },

    greeting(hour: number) {
      return clinic.assistantName ? `${r.salutation(hour)} This is ${clinic.assistantName} from ${clinic.name}.` : `${r.salutation(hour)} You've reached ${clinic.name}.`;
    },

    again(random: () => number = Math.random) {
      const options = ["Of course!", "Happy to!", "Sure thing!"];
      return options[Math.floor(random() * options.length)];
    },

    staff(urgent: boolean) {
      return urgent
        ? "I'm so sorry. I'm letting the team know right now so they can talk to you as soon as possible. If the pain or swelling gets worse, please go to an emergency room."
        : "Understood. I'll get someone from our team to talk to you here. They'll reach out as soon as possible.";
    },

    stayOnTopic() {
      return "I can only help with information about the clinic, treatments and appointments. How can I help?";
    },

    myName() {
      return clinic.assistantName ? `I'm ${clinic.assistantName} from ${clinic.name}. How can I help?` : `This is ${clinic.name}. How can I help?`;
    },

    howCanIHelp() {
      return "How can I help you?";
    },

    calmDown() {
      return "I understand your frustration. I'm here to help with clinic information and appointments whenever you're ready.";
    },
  };
  return r;
}
