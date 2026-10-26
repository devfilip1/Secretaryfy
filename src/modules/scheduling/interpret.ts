import { DateTime } from "luxon";
import { z } from "zod";
import type { SchedulingStep, SessionOption } from "../../db/schema.js";
import { findDatesInText, formatDay, formatTime, minutesOfDay, parseSimpleDate, parseTimeOfDay } from "./dates.js";
import type { ChatMessage, OllamaClient } from "./ollama.js";
import { SERVICES, detectService, serviceByNumber } from "./services.js";

/** Intenções que o agendamento entende (contracts/interpreter.md). */
export const INTENTS = [
  "book",
  "availability",
  "cancel",
  "reschedule",
  "my_appointment",
  "choose",
  "more",
  "other_day",
  "yes",
  "no",
  "give_name",
  "choose_service",
  "stop",
  "goodbye",
  "question",
  "unclear",
] as const;

export type Intent = (typeof INTENTS)[number];

export interface Interpretation {
  intent: Intent;
  /** Número da opção escolhida (intent = choose) */
  option: number | null;
  /** YYYY-MM-DD no fuso da clínica */
  date: string | null;
  name: string | null;
  /** Serviço do catálogo (intent = choose_service, specs/005) */
  service?: string | null;
  source: "rule" | "model";
  /** A data pedida passa do limite de dias à frente: o fluxo explica, e não conta como "não entendi" */
  tooFar?: boolean;
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

const HISTORY_LIMIT = 20;

const YES = new Set(["yes", "y", "yeah", "yep", "yup", "sure", "ok", "okay", "confirm", "confirmed", "correct", "sim", "yes please", "ok thanks"]);
const NO = new Set(["no", "n", "nope", "not", "nao", "não", "no thanks", "no thank you"]);
/** Respostas ao lembrete que também confirmam presença (normalizadas: sem apóstrofo nem pontuação) */
const ATTENDING = new Set(["i ll be there", "ill be there", "i will be there", "see you", "see you there", "see you then", "yes i ll be there", "yes confirmed", "confirmed thanks", "yes thanks"]);
const MORE = new Set(["more", "more options", "others", "other times", "more times", "show more", "anything else"]);
const OTHER_DAY = new Set(["other day", "another day", "different day", "other date", "another date", "a different day"]);
const CHOOSING: (SchedulingStep | null)[] = ["choose_day", "choose_slot"];
const CONFIRMING: (SchedulingStep | null)[] = ["confirm_booking", "confirm_cancel", "confirm_reschedule", "offer_reschedule"];
/** Agradecimento ou despedida sem mais nada ("right, thank you so much, bye"): uma destas palavras... */
const CLOSING_CORE = new Set(["thank", "thanks", "thx", "ty", "bye", "byee", "by", "goodbye", "cya", "cheers", "appreciate", "obrigado", "obrigada", "valeu", "tchau"]);
/** ...e as demais só desta lista */
const CLOSING_FILLER = new Set(
  (
    "right alright all ok okay oh ah great perfect cool awesome nice good wonderful excellent yes yeah sure " +
    "you so much very a lot many for it that s everything your help again then now the have day night evening weekend " +
    "see ya later soon take care kind regards got will do"
  ).split(" "),
);
const NAME = /^[\p{L}][\p{L}'.-]*(?: [\p{L}][\p{L}'.-]*){0,3}$/u;
/** Palavras que nunca fazem parte de um nome: perguntas, respostas curtas, saudações, dias e tratamentos (FR-004). */
const NOT_NAMES = new Set(
  (
    "hi hello hey why what how who when where which no yes ok okay sure thanks thank bye please help price prices cost " +
    "much is are the a an you your my me i it this that do does can could would want need book appointment " +
    "today tomorrow monday tuesday wednesday thursday friday saturday sunday morning afternoon evening " +
    "teeth tooth dental not know"
  )
    .split(" ")
    // As palavras dos tratamentos ("Braces" não é um nome)
    .concat(SERVICES.flatMap((s) => s.words.flatMap((w) => w.split(" ")))),
);
const MAX_NAME_CHARS = 60;
/** "my name is X" vale em qualquer momento */
const MY_NAME = /^(?:(?:hi|hello|hey)[,!.]?\s+)?(?:my name is|my name's|call me)\s+(.+)$/i;
/** "I'm X" só logo depois do pedido de nome: fora dele, "I'm interested" não é um nome */
const I_AM = /^(?:(?:hi|hello|hey)[,!.]?\s+)?(?:i'm|i am|im|it's|its|this is)\s+(.+)$/i;

/** O nome escrito pelo cliente, limpo e com iniciais maiúsculas; null se não parecer um nome (contracts/interpreter.md). */
export function cleanName(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, "").replace(/\.$/, "").replace(/\s+/g, " ").trim();
  // NAME aceita até 4 palavras
  if (!text || text.length > MAX_NAME_CHARS || !NAME.test(text)) return null;
  const words = text.split(" ");
  if (words.some((w) => NOT_NAMES.has(w.toLowerCase()))) return null;
  return words.map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase()).join(" ");
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/ ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const result = (intent: Intent, extra: Partial<Interpretation> = {}): Interpretation => ({
  intent,
  option: null,
  date: null,
  name: null,
  source: "rule",
  ...extra,
});

/** Regras sem modelo (contracts/interpreter.md §1). null = deixar para o modelo. */
function byRules({ text, step, options, now, timeZone, window, awaitingName, awaitingReminder }: InterpretInput): Interpretation | null {
  const t = normalize(text);
  if (!t) return result("unclear");

  if (CHOOSING.includes(step) && /^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return options.some((o) => o.n === n) ? result("choose", { option: n }) : result("unclear");
  }
  if (step === "choose_slot" && MORE.has(t)) return result("more");
  if (step === "choose_slot") {
    // "the 10 am one", "2:30 pm": o horário citado, se estiver entre os oferecidos
    const minutes = parseTimeOfDay(text);
    const match = minutes === null ? undefined : options.find((o) => o.kind === "slot" && minutesOfDay(new Date(o.start), timeZone) === minutes);
    if (match) return result("choose", { option: match.n });
  }
  if (CHOOSING.includes(step) && OTHER_DAY.has(t)) return result("other_day");
  if (CONFIRMING.includes(step)) {
    if (YES.has(t)) return result("yes");
    if (NO.has(t)) return result("no");
  }
  // Resposta ao lembrete, sem agendamento em andamento: YES confirma o horário (specs/006 R5)
  if (step === null && awaitingReminder) {
    if (YES.has(t) || ATTENDING.has(t)) return result("yes");
    if (NO.has(t)) return result("no");
  }
  // Serviço (specs/005): pelo número ou pelo nome na lista; no resumo, citar outro tratamento troca o serviço
  if (step === "choose_service" && /^\d{1,2}$/.test(t)) {
    const service = serviceByNumber(Number(t));
    return service ? result("choose_service", { service }) : result("unclear");
  }
  if (step === "choose_service" || step === "confirm_booking") {
    const service = detectService([text]);
    if (service) return result("choose_service", { service });
  }
  if (step === null || CHOOSING.includes(step)) {
    const date = parseSimpleDate(text, { now, timeZone });
    if (date) {
      const intent = step === null ? "availability" : "choose";
      return result(intent, { date, ...(date > window.lastDate ? { tooFar: true } : {}) });
    }
  }
  // Depois do sim/não da confirmação: lá "ok thanks" é um sim
  const words = t.split(" ");
  if (words.some((w) => CLOSING_CORE.has(w)) && words.every((w) => CLOSING_CORE.has(w) || CLOSING_FILLER.has(w))) {
    return result("goodbye");
  }
  const told = MY_NAME.exec(text.trim());
  if (told) {
    const name = cleanName(told[1]);
    if (name) return result("give_name", { name });
  }
  // A mensagem inteira como nome só logo depois do pedido, para "Braces" ou "Friday" nunca virarem nome
  if ((awaitingName || step === "ask_name") && !YES.has(t) && !NO.has(t)) {
    const name = cleanName(I_AM.exec(text.trim())?.[1] ?? text);
    if (name) return result("give_name", { name });
  }
  return null;
}

const FORMAT = {
  type: "object",
  properties: {
    intent: { type: "string", enum: INTENTS },
    option: { type: ["integer", "null"] },
    date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    name: { type: ["string", "null"] },
    service: { type: ["string", "null"] },
  },
  required: ["intent", "option", "date", "name"],
};

const modelOutput = z.object({
  intent: z.enum(INTENTS),
  option: z.number().int().nullable(),
  date: z.string().nullable(),
  name: z.string().nullable(),
  service: z.string().nullable().optional(),
});

const STEP_HINTS: Record<SchedulingStep, string> = {
  choose_day: "The assistant offered numbered DAYS and is waiting for the customer to pick one.",
  choose_slot: "The assistant offered numbered TIMES on one day and is waiting for the customer to pick one.",
  ask_name: "The assistant asked the customer's name for the appointment.",
  confirm_booking: "The assistant asked the customer to confirm a booking (yes/no).",
  offer_reschedule: "The customer already has an appointment; the assistant asked if they want to reschedule it (yes/no).",
  confirm_cancel: "The assistant asked the customer to confirm cancelling their appointment (yes/no).",
  confirm_reschedule: "The assistant asked the customer to confirm moving their appointment (yes/no).",
  choose_service: "The assistant offered a numbered list of SERVICES (treatments) and is waiting for the customer to pick one.",
};

function systemPrompt({ step, options, now, timeZone, awaitingName, awaitingReminder }: InterpretInput): string {
  const today = DateTime.fromJSDate(now, { zone: timeZone }).setLocale("en-US");
  const offered = options
    .map((o) => {
      if (o.kind === "day") return `${o.n}. ${formatDay(o.date, timeZone)} (${o.date})`;
      if (o.kind === "slot") return `${o.n}. ${formatTime(new Date(o.start), timeZone)}`;
      return `${o.n}. ${o.service}`;
    })
    .join("\n");
  return [
    "You classify WhatsApp messages sent to the scheduling assistant of DentalSafe, a dental clinic.",
    "Do NOT answer the customer. Return only the JSON object.",
    "",
    `Today is ${today.toFormat("cccc, yyyy-MM-dd")}. Time zone: ${timeZone}.`,
    `Current step: ${step ? `${step}. ${STEP_HINTS[step]}` : "none (no booking in progress)."}`,
    offered ? `Options offered by the assistant:\n${offered}` : "No options are on screen.",
    "",
    "Intents:",
    '- book: wants to make an appointment ("I want to book", "can I schedule a visit?")',
    '- availability: asks which days or times are free without asking to book yet ("what times do you have on Friday?")',
    '- cancel: wants to cancel their appointment',
    '- reschedule: wants to change the date or time of their appointment',
    '- my_appointment: asks when their appointment is',
    '- choose: picks one of the offered options, by number, by its time ("the 10 am one") or by naming a day; set "option" to the number, or "date" when they name a day',
    '- more: wants to see more times',
    '- other_day: wants a different day than the ones offered',
    '- yes / no: answers a yes/no question from the assistant',
    '- give_name: tells their name; set "name"',
    '- choose_service: picks the service/treatment for the appointment; set "service" to the treatment',
    '- stop: gives up on booking ("never mind", "forget it")',
    `- goodbye: only thanks the assistant or says goodbye, asking nothing else ("thanks, bye", "that's all, have a nice day")`,
    '- question: any question about the clinic, treatments, prices, location or hours',
    "- unclear: anything else, or when you are not sure",
    "",
    'Rules: "date" must be YYYY-MM-DD computed from today\'s date, or null. Only use "option" with a number from the list above. When in doubt, use unclear.',
    ...(awaitingName ? ["", `The assistant has just asked the customer's name. If the message contains it, set "name".`] : []),
    ...(awaitingReminder
      ? ["", "The assistant reminded the customer of their appointment and asked them to reply YES to confirm. A confirmation is \"yes\"; a refusal is \"no\"."]
      : []),
  ].join("\n");
}

/** Valida a saída do modelo contra a etapa e a janela de datas (contracts/interpreter.md §3). */
function validate(raw: unknown, { text, options, window, now, timeZone, awaitingName }: InterpretInput): Interpretation {
  const parsed = modelOutput.safeParse(raw);
  if (!parsed.success) return result("unclear", { source: "model" });
  const { intent, option, name } = parsed.data;
  let { date } = parsed.data;

  // Uma data simples citada na frase vale mais que a calculada pelo modelo, que erra dias da semana
  const cited = findDatesInText(text, { now, timeZone });
  if (cited.length === 1 && ["book", "availability", "choose", "reschedule"].includes(intent)) date = cited[0];

  if (date !== null) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && DateTime.fromISO(date).isValid;
    if (!valid || date < window.firstDate) return result("unclear", { source: "model" });
  }
  if (intent === "choose") {
    if (option !== null && !options.some((o) => o.n === option)) return result("unclear", { source: "model" });
    if (option === null && date === null) return result("unclear", { source: "model" });
  } else if (!["book", "availability", "reschedule"].includes(intent)) {
    date = null;
  }
  // Logo depois do pedido de nome, o nome pode vir junto de qualquer intenção ("I'm Maria, how much is…?")
  const keepsName = awaitingName || intent === "give_name" || intent === "book";
  const cleaned = keepsName ? cleanName(name) : null;
  if (intent === "give_name" && !cleaned) return result("unclear", { source: "model" });
  // O serviço tem de ser do catálogo: o nome devolvido pelo modelo passa pelas mesmas palavras da conversa
  const service = intent === "choose_service" ? detectService([parsed.data.service ?? ""]) : null;
  if (intent === "choose_service" && !service) return result("unclear", { source: "model" });
  return {
    intent,
    option: intent === "choose" ? option : null,
    date,
    name: cleaned,
    ...(service ? { service } : {}),
    source: "model",
    ...(date && date > window.lastDate ? { tooFar: true } : {}),
  };
}

export function createInterpreter({ ollama }: { ollama: Pick<OllamaClient, "chat"> }) {
  return {
    /** Lança InterpreterUnavailable se o modelo for necessário e o Ollama não responder. */
    async interpret(input: InterpretInput): Promise<Interpretation> {
      const ruled = byRules(input);
      if (ruled) return ruled;

      const raw = await ollama.chat({
        format: FORMAT,
        messages: [
          { role: "system", content: systemPrompt(input) },
          ...input.history.slice(-HISTORY_LIMIT),
          { role: "user", content: input.text },
        ],
      });
      return validate(raw, input);
    },
  };
}

export type Interpreter = ReturnType<typeof createInterpreter>;
