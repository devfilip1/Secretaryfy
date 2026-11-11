import type { ClinicContext } from "../clinic/context.js";
import type { ServiceCatalog } from "./catalog.js";
import type { DayPeriod } from "./interpret.js";
import { createEnglishReplies } from "./replies.en.js";
import { createPortugueseReplies } from "./replies.pt.js";

/**
 * Textos enviados ao cliente pelo WhatsApp, na língua da clínica, lida a cada texto (contracts/conversation.md). O modelo
 * nunca escreve estes textos: "booked" só sai daqui depois de o evento existir na agenda (FR-024).
 */
export interface Replies {
  offerDays(days: string[], tz: string, intro?: string): string;
  offerSlots(date: string, slots: Date[], tz: string, hasMore: boolean): string;
  /** O cliente pediu uma parte do dia sem horário livre nela, mas o dia tem outros: oferece esses (`slots`) */
  periodEmpty(date: string, period: DayPeriod, slots: Date[], tz: string, hasMore: boolean): string;
  dayFull(date: string, closest: string[], tz: string): string;
  /** O dia pedido é um dia em que a clínica não atende (regras semanais do painel) */
  /** A clínica não atende nesses dias da semana (ISO, 1 = segunda): todos de uma vez, para "fim de semana?" também ter resposta */
  closedDay(closedWeekdays: number[], closest: string[], tz: string): string;
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
  /** Só a saudação pela hora do dia ("Boa noite!"), sem quem fala: é o que o folheto vê da nossa saudação */
  salutation(hour: number): string;
  /** O cliente pediu um horário que não está na lista do dia: avisa com gentileza e oferece os que existem */
  slotNotOffered(date: string, slots: Date[], tz: string): string;
  /** Abre a resposta que repete, palavra por palavra, uma que já demos (a proteção descartaria o texto igual) */
  again(random?: () => number): string;
  /** O cliente precisa de alguém da equipe (a conversa é pausada); `urgent`: dor, inchaço ou outra urgência de saúde */
  staff(urgent: boolean): string;
  /** Tentativa de mudar o comportamento ou de extrair as instruções: nada é respondido, volta ao assunto da clínica */
  stayOnTopic(): string;
  /** O cliente perguntou o nome de quem atende */
  myName(): string;
  /** O cliente xingou: resposta breve e educada, sem pedido de nome nem oferta. */
  calmDown(): string;
}

/** O primeiro nome, para chamar o cliente como uma pessoa chamaria. */
export const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

/** "a, b e c" / "a, b and c" */
export const joinList = (items: string[], and: string) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;

/** Período do dia para a saudação: de madrugada ainda é noite ("Boa noite" à 1h, não "Bom dia"). */
export const dayPeriod = (hour: number): "morning" | "afternoon" | "evening" =>
  hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";

/**
 * Os textos na língua da clínica, lida a cada texto (o painel pode trocá-la): a mensagem seguinte já sai na nova língua.
 * Os dois pacotes são montados uma vez; cada método escolhe o pacote no momento da chamada.
 */
export function createReplies({
  clinic,
  catalog,
}: {
  clinic: Pick<ClinicContext, "name" | "assistantName" | "language">;
  catalog: ServiceCatalog;
}): Replies {
  const packs = { en: createEnglishReplies({ clinic, catalog }), pt: createPortugueseReplies({ clinic, catalog }) };
  const keys = Object.keys(packs.en) as (keyof Replies)[];
  if (keys.some((key) => typeof packs.en[key] !== "function")) throw new Error("Replies: todo membro tem de ser função");
  const live = keys.map((key) => [key, (...args: unknown[]) => (packs[clinic.language][key] as (...args: unknown[]) => unknown)(...args)]);
  return Object.fromEntries(live) as unknown as Replies;
}
