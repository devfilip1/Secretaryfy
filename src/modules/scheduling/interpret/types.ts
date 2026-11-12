/** Formato da interpretação e da entrada do interpretador, e o construtor da interpretação (usados por rules, validate e interpret). */
import type { SchedulingStep, SessionOption } from "../../../db/schema.js";
import type { Intent } from "../intents.js";
import type { ChatMessage } from "../ollama.js";
import type { DayPeriod } from "../understanding/when.js";

export interface Interpretation {
  intent: Intent;
  /** Número da opção escolhida (intent = choose) */
  option: number | null;
  /** YYYY-MM-DD no fuso da clínica */
  date: string | null;
  /** Horário que o cliente citou (HH:mm, 24 h), em choose, book, availability ou reschedule; ausente se não citou */
  time?: string | null;
  /** Parte do dia que o cliente pediu sem citar um horário ('de manhã', 'à tarde', 'à noite'); ausente se não pediu */
  period?: DayPeriod | null;
  name: string | null;
  /** Nome do serviço do catálogo (a chave do tratamento, ou ASSESSMENT) que o modelo deu, em qualquer intenção; ausente se não deu */
  service?: string | null;
  source: "rule" | "model";
  /** needs_staff: dor, inchaço, sangramento ou outra urgência de saúde (o texto ao cliente muda) */
  urgent?: boolean;
  /** A data pedida passa do limite de dias à frente: o fluxo explica, e não conta como "não entendi" */
  tooFar?: boolean;
  /** O fim de semana inteiro (sábado e domingo), sem um dia citado: o fluxo oferece os dois, nunca um só */
  weekend?: boolean;
}

export interface InterpretInput {
  text: string;
  step: SchedulingStep | null;
  options: SessionOption[];
  /** Mensagens anteriores da conversa, sem a atual */
  history: ChatMessage[];
  now: Date;
  timeZone: string;
  window: { firstDate: string; lastDate: string };
  /** O assistente acabou de pedir o nome e esta é a primeira mensagem do cliente depois disso (specs/005, R3) */
  awaitingName: boolean;
  /** O assistente lembrou o cliente do horário e pediu YES para confirmar (specs/006, research.md R5) */
  awaitingReminder?: boolean;
}

/** Interpretação sem campos extras: o que o fluxo lê; o resto fica ausente. */
export const result = (intent: Intent, extra: Partial<Interpretation> = {}): Interpretation => ({
  intent,
  option: null,
  date: null,
  name: null,
  source: "rule",
  ...extra,
});
