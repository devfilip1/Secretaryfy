import { fixedTextsFor } from "../antiban/texts.js";
import { DateTime } from "luxon";
import { formatDayLong, formatTime, formatWhen, weekdayNames } from "./dates.js";
import { ASSESSMENT, type ServiceCatalog } from "./catalog.js";
import { dayPeriod, firstName, joinList, type Replies } from "./replies.js";

const bullets = (lines: string[]) => lines.map((line) => `• ${line}`).join("\n");

/** "na sexta-feira, 6 de novembro" (ou "Na…" no começo da frase): o artigo muda com o gênero do dia da semana. */
const onDay = (date: string, tz: string, capital = false) => {
  const article = DateTime.fromISO(date, { zone: tz }).weekday >= 6 ? "no" : "na";
  return `${capital ? "N" + article.slice(1) : article} ${formatDayLong(date, tz, "pt")}`;
};

const hoursText = (minutes: number) => {
  if (minutes % 60 !== 0) return `${minutes} minutos`;
  const h = minutes / 60;
  return h === 1 ? "1 hora" : `${h} horas`;
};

/** Textos em português do Brasil, com o nome da clínica dado pela configuração (CLINIC_NAME). */
export function createPortugueseReplies({
  clinicName,
  assistantName,
  catalog,
}: {
  clinicName: string;
  assistantName?: string;
  catalog: ServiceCatalog;
}): Replies {
  const pt = "pt";
  const r: Replies = {
    offerDays(days: string[], tz: string, intro = "Claro! Tenho horários livres nestes dias:") {
      return `${intro}\n${bullets(days.map((d) => formatDayLong(d, tz, pt)))}\nQual deles fica melhor para você? Se preferir outra data, é só me dizer.`;
    },

    offerSlots(date: string, slots: Date[], tz: string, hasMore: boolean) {
      const tail = hasMore ? "Se quiser ver mais horários ou outro dia, é só pedir." : "Se preferir outro dia, é só pedir.";
      return `${onDay(date, tz, true)}, tenho estes horários:\n${bullets(slots.map((s) => formatTime(s, tz, pt)))}\nQual prefere? ${tail}`;
    },

    closedDay(closedWeekdays: number[], closest: string[], tz: string) {
      // "sábado e domingo", "segunda": sem o "-feira", como se fala
      const names = closedWeekdays.map((d) => weekdayNames("pt")[d - 1]);
      return r.offerDays(closest, tz, `Não atendemos ${joinList(names, "e")}. Os dias mais próximos com horários livres são:`);
    },

    dayFull(date: string, closest: string[], tz: string) {
      return r.offerDays(closest, tz, `Desculpe, não há mais horários ${onDay(date, tz)}. Os dias mais próximos com horários livres são:`);
    },

    tooFar(maxDaysAhead: number, lastDate: string, closest: string[], tz: string) {
      return r.offerDays(
        closest,
        tz,
        `Só consigo marcar até ${maxDaysAhead} dias à frente, até ${formatDayLong(lastDate, tz, pt)}. Estes são os dias mais próximos:`,
      );
    },

    noOpenings() {
      return "Desculpe, não há horários livres nos próximos dias. Por favor, entre em contato com a clínica diretamente.";
    },

    askName() {
      return "Qual nome devo colocar no agendamento?";
    },

    /** Lista numerada dos serviços (specs/005, etapa choose_service). */
    chooseService(name?: string | null) {
      const who = firstName(name);
      const lines = catalog.list().map((s) => (s.name === ASSESSMENT ? "Não tenho certeza — avaliação geral" : catalog.label(s.name, "pt")));
      return `${who ? `${who}, para` : "Para"} qual serviço é este agendamento?\n${bullets(lines)}\nÉ só me dizer qual.`;
    },

    confirmBooking(start: Date, slotMinutes: number, name: string, service: string, tz: string) {
      return [
        "Só para confirmar:",
        `📅 ${formatWhen(start, tz, pt)} (${slotMinutes} min)`,
        `👤 ${name}`,
        `🦷 ${catalog.label(service, "pt")}`,
        "Posso confirmar? Se algo estiver errado, como o nome, o horário ou o serviço, é só me dizer.",
      ].join("\n");
    },

    booked(start: Date, tz: string, name?: string | null) {
      const who = firstName(name);
      return `Tudo certo${who ? `, ${who}` : ""}, seu horário está marcado! 📅 ${formatWhen(start, tz, pt)}. Até lá, na ${clinicName}.`;
    },

    slotTaken(date: string, slots: Date[], tz: string) {
      const list = bullets(slots.map((s) => formatTime(s, tz, pt)));
      return `Desculpe, esse horário acabou de ser ocupado. Os horários mais próximos ${onDay(date, tz)} são:\n${list}\nQual prefere? Se preferir outro dia, é só pedir.`;
    },

    alreadyBooked(start: Date, tz: string) {
      return `Você já tem um agendamento em ${formatWhen(start, tz, pt)}. Quer remarcá-lo?`;
    },

    myAppointment(start: Date, tz: string) {
      return `Seu agendamento é em ${formatWhen(start, tz, pt)}.`;
    },

    noAppointment() {
      return "Não encontrei nenhum agendamento para este número.";
    },

    confirmCancel(start: Date, tz: string) {
      return `Quer mesmo cancelar seu agendamento de ${formatWhen(start, tz, pt)}?`;
    },

    cancelled(start: Date, tz: string) {
      return `Seu agendamento de ${formatWhen(start, tz, pt)} foi cancelado.`;
    },

    keptAppointment(start: Date, tz: string) {
      return `Tudo bem, seu agendamento de ${formatWhen(start, tz, pt)} continua como está.`;
    },

    confirmReschedule(from: Date, to: Date, tz: string) {
      return `Posso mudar seu agendamento de ${formatWhen(from, tz, pt)} para ${formatWhen(to, tz, pt)}?`;
    },

    rescheduled(start: Date, tz: string) {
      return `Pronto! Seu agendamento agora é em ${formatWhen(start, tz, pt)}.`;
    },

    tooLateToChange(cancelNoticeMinutes: number) {
      return `Seu agendamento é em menos de ${hoursText(cancelNoticeMinutes)}, então não consigo alterá-lo por aqui. Por favor, entre em contato com a clínica diretamente.`;
    },

    stopped() {
      return "Sem problemas. Me avise se quiser marcar depois.";
    },

    /** Última mensagem da primeira resposta a quem ainda não disse o nome (specs/005, contracts/conversation.md). */
    askNameFollowUp(random: () => number = Math.random) {
      const options = [
        "A propósito, qual é o seu nome?",
        "A propósito, pode me dizer seu nome?",
        "Antes que eu esqueça, pode me dizer seu nome?",
      ];
      return options[Math.floor(random() * options.length)];
    },

    /** O cliente disse o nome, sem pergunta junto. */
    nameReceived(name: string, random: () => number = Math.random) {
      const who = firstName(name);
      const options = [`Prazer, ${who}! Como posso ajudar?`, `Obrigado, ${who}! Como posso ajudar hoje?`];
      return options[Math.floor(random() * options.length)];
    },

    /** O cliente agradeceu ou se despediu: sem convite para agendar, só a despedida. */
    goodbye(random: () => number = Math.random, name?: string | null) {
      const who = firstName(name);
      const options = [
        `De nada${who ? `, ${who}` : ""}! Tenha um ótimo dia 😊`,
        `Sempre que precisar${who ? `, ${who}` : ""}! Cuide-se 😊`,
        `Foi um prazer! Até breve na ${clinicName}.`,
        "Que bom que pude ajudar! Tenha um bom dia.",
      ];
      return options[Math.floor(random() * options.length)];
    },

    unclear(repeat: string) {
      return `Desculpe, não entendi. ${repeat}`;
    },

    handoff() {
      return "Desculpe, estou com dificuldade para entender. Alguém da nossa equipe vai continuar o atendimento com você por aqui em breve.";
    },

    calendarUnavailable() {
      return "Desculpe, não consigo marcar horários agora. Tente novamente mais tarde ou entre em contato com a clínica.";
    },

    interpreterUnavailable() {
      return fixedTextsFor("pt").unavailable[0];
    },

    /**
     * Lembrete 24 h antes (specs/006): três variações, para nunca repetir o último texto enviado à conversa.
     * O agendador escolhe com gate.pickVariant.
     */
    reminder(start: Date, service: string, name: string | null, tz: string): string[] {
      const when = formatWhen(start, tz, pt);
      const label = catalog.label(service, "pt");
      return [
        `Oi${name ? ` ${name}` : ""}! Lembrete do seu agendamento na ${clinicName} em ${when} (${label}). Você confirma?`,
        `Olá${name ? ` ${name}` : ""}, seu agendamento de ${label} na ${clinicName} é em ${when}. Você confirma presença?`,
        `Oi${name ? ` ${name}` : ""}, aqui é a ${clinicName} lembrando do seu agendamento em ${when} para ${label}. Você confirma? Se precisar remarcar, é só me dizer.`,
      ];
    },

    /** O cliente respondeu SIM ao lembrete. */
    reminderConfirmed(start: Date, name: string | null, tz: string) {
      return `Obrigado${name ? `, ${name}` : ""}! Seu agendamento em ${formatWhen(start, tz, pt)} está confirmado. Até lá, na ${clinicName}.`;
    },

    daysIntro() {
      return "Estes dias têm horários livres:";
    },

    noMoreOpeningsToday() {
      return "Não há mais horários nesse dia. Outros dias com horários livres:";
    },

    yesOrNo() {
      return "Pode me dizer se sim ou não?";
    },

    howCanIHelp() {
      return "Como posso ajudar?";
    },

    salutation(hour: number) {
      return `${{ morning: "Bom dia", afternoon: "Boa tarde", evening: "Boa noite" }[dayPeriod(hour)]}!`;
    },

    greeting(hour: number) {
      return assistantName ? `${r.salutation(hour)} Meu nome é ${assistantName}, da ${clinicName}.` : `${r.salutation(hour)} Aqui é da ${clinicName}.`;
    },

    again(random: () => number = Math.random) {
      const options = ["Como comentei:", "Só reforçando:", "Repetindo para você:"];
      return options[Math.floor(random() * options.length)];
    },

    staff(urgent: boolean) {
      return urgent
        ? "Sinto muito por isso. Já estou avisando a equipe para falar com você o quanto antes. Se a dor ou o inchaço piorar, procure um pronto atendimento."
        : "Entendi. Vou chamar alguém da nossa equipe para falar com você por aqui. Assim que possível, entram em contato.";
    },

    stayOnTopic() {
      return "Só consigo ajudar com informações da clínica, tratamentos e agendamentos. Como posso ajudar?";
    },

    myName() {
      return assistantName ? `Meu nome é ${assistantName}, da ${clinicName}. Como posso ajudar?` : `Aqui é da ${clinicName}. Como posso ajudar?`;
    },

    calmDown() {
      return "Entendo sua frustração. Estou aqui para ajudar com informações da clínica e agendamentos, quando quiser.";
    },
  };
  return r;
}
