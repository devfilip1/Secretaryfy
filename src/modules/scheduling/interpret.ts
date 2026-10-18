import { DateTime } from "luxon";
import { z } from "zod";
import type { SchedulingStep, SessionOption } from "../../db/schema.js";
import { findDatesInText, formatDay, formatTime, minutesOfDay, parseSimpleDate, parseTimeOfDay } from "./dates.js";
import type { ChatMessage, OllamaClient } from "./ollama.js";

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
  "stop",
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
}

const HISTORY_LIMIT = 20;

const YES = new Set(["yes", "y", "yeah", "yep", "yup", "sure", "ok", "okay", "confirm", "confirmed", "correct", "sim", "yes please", "ok thanks"]);
const NO = new Set(["no", "n", "nope", "not", "nao", "não", "no thanks", "no thank you"]);
const MORE = new Set(["more", "more options", "others", "other times", "more times", "show more", "anything else"]);
const OTHER_DAY = new Set(["other day", "another day", "different day", "other date", "another date", "a different day"]);
const CHOOSING: (SchedulingStep | null)[] = ["choose_day", "choose_slot"];
const CONFIRMING: (SchedulingStep | null)[] = ["confirm_booking", "confirm_cancel", "confirm_reschedule", "offer_reschedule"];
const NAME = /^[\p{L}][\p{L}'.-]*(?: [\p{L}][\p{L}'.-]*){0,3}$/u;

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
function byRules({ text, step, options, now, timeZone, window }: InterpretInput): Interpretation | null {
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
  if (step === null || CHOOSING.includes(step)) {
    const date = parseSimpleDate(text, { now, timeZone });
    if (date) {
      const intent = step === null ? "availability" : "choose";
      return result(intent, { date, ...(date > window.lastDate ? { tooFar: true } : {}) });
    }
  }
  if (step === "ask_name" && NAME.test(text.trim()) && !YES.has(t) && !NO.has(t)) {
    return result("give_name", { name: text.trim().replace(/\s+/g, " ") });
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
  },
  required: ["intent", "option", "date", "name"],
};

const modelOutput = z.object({
  intent: z.enum(INTENTS),
  option: z.number().int().nullable(),
  date: z.string().nullable(),
  name: z.string().nullable(),
});

const STEP_HINTS: Record<SchedulingStep, string> = {
  choose_day: "The assistant offered numbered DAYS and is waiting for the customer to pick one.",
  choose_slot: "The assistant offered numbered TIMES on one day and is waiting for the customer to pick one.",
  ask_name: "The assistant asked the customer's name for the appointment.",
  confirm_booking: "The assistant asked the customer to confirm a booking (yes/no).",
  offer_reschedule: "The customer already has an appointment; the assistant asked if they want to reschedule it (yes/no).",
  confirm_cancel: "The assistant asked the customer to confirm cancelling their appointment (yes/no).",
  confirm_reschedule: "The assistant asked the customer to confirm moving their appointment (yes/no).",
};

function systemPrompt({ step, options, now, timeZone }: InterpretInput): string {
  const today = DateTime.fromJSDate(now, { zone: timeZone }).setLocale("en-US");
  const offered = options
    .map((o) =>
      o.kind === "day" ? `${o.n}. ${formatDay(o.date, timeZone)} (${o.date})` : `${o.n}. ${formatTime(new Date(o.start), timeZone)}`,
    )
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
    '- stop: gives up on booking ("never mind", "forget it")',
    '- question: any question about the clinic, treatments, prices, location or hours',
    "- unclear: anything else, or when you are not sure",
    "",
    'Rules: "date" must be YYYY-MM-DD computed from today\'s date, or null. Only use "option" with a number from the list above. When in doubt, use unclear.',
  ].join("\n");
}

/** Valida a saída do modelo contra a etapa e a janela de datas (contracts/interpreter.md §3). */
function validate(raw: unknown, { text, options, window, now, timeZone }: InterpretInput): Interpretation {
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
  return {
    intent,
    option: intent === "choose" ? option : null,
    date,
    name: intent === "give_name" || intent === "book" ? (name?.trim() || null) : null,
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
