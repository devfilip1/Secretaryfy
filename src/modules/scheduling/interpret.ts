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
/** O cliente fala de hoje: só então a data de hoje, devolvida pelo modelo num pedido sem dia, vale */
const SAYS_TODAY = /\b(today|tonight|now|this (?:morning|afternoon|evening))\b/i;

const YES = new Set(["yes", "y", "yeah", "yep", "yup", "sure", "ok", "okay", "confirm", "confirmed", "correct", "sim", "yes please", "ok thanks", "claro", "pode ser", "com certeza", "confirmo", "isso"]);
const NO = new Set(["no", "n", "nope", "not", "nao", "não", "no thanks", "no thank you", "nao quero", "de jeito nenhum"]);
/** Respostas ao lembrete que também confirmam presença (normalizadas: sem apóstrofo nem pontuação) */
const ATTENDING = new Set(["i ll be there", "ill be there", "i will be there", "see you", "see you there", "see you then", "yes i ll be there", "yes confirmed", "confirmed thanks", "yes thanks"]);
const MORE = new Set(["more", "more options", "others", "other times", "more times", "show more", "anything else", "mais", "mais horarios", "outros horarios"]);
const OTHER_DAY = new Set(["other day", "another day", "different day", "other date", "another date", "a different day", "outro dia", "outra data", "outro dia por favor", "outra data por favor"]);
/** Dia da semana citado (normalizado, sem "-feira"): o mesmo dia da lista oferecida (ISO 1 = segunda). */
const WEEKDAYS: Record<string, number> = {
  segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, domingo: 7,
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};
const WANTS_MORE = /\b(?:mais|more)\b/;
const WANTS_OTHER_DAY = /\b(?:outro|outra|another|other|different)\b/;
const FIRST = /\b(?:primeiro|primeira|first)\b/;
const LAST = /\b(?:ultimo|ultima|last)\b/;
const THIS_ONE = /^(?:(?:quero|pode ser|vou de|fico com|i ll take|i want|i ll go with) )?(?:esse|essa|este|esta|isso|this one|that one)(?: dia| horario| mesmo)?$/;
const CHOOSING: (SchedulingStep | null)[] = ["choose_day", "choose_slot"];
const CONFIRMING: (SchedulingStep | null)[] = ["confirm_booking", "confirm_cancel", "confirm_reschedule", "offer_reschedule"];
/** Agradecimento ou despedida sem mais nada ("right, thank you so much, bye"): uma destas palavras... */
const CLOSING_CORE = new Set(["thank", "thanks", "thx", "ty", "bye", "byee", "by", "goodbye", "cya", "cheers", "appreciate", "obrigado", "obrigada", "brigado", "brigada", "valeu", "tchau"]);
/** ...e as demais só desta lista */
const CLOSING_FILLER = new Set(
  (
    "right alright all ok okay oh ah great perfect cool awesome nice good wonderful excellent yes yeah sure " +
    "you so much very a lot many for it that s everything your help again then now the have day night evening weekend " +
    "see ya later soon take care kind regards got will do muito ate mais logo bom boa dia noite tarde um uma"
  ).split(" "),
);
const NAME = /^[\p{L}][\p{L}'.-]*(?: [\p{L}][\p{L}'.-]*){0,3}$/u;
/** Palavras que nunca fazem parte de um nome: perguntas, respostas curtas, saudações, dias e tratamentos (FR-004). */
const NOT_NAMES = new Set(
  (
    "hi hello hey why what how who when where which no yes ok okay sure thanks thank bye please help price prices cost " +
    "much is are the a an you your my me i it this that do does can could would want need book appointment " +
    "today tomorrow monday tuesday wednesday thursday friday saturday sunday morning afternoon evening " +
    "qual quais quem como onde quando quanto porque pq seu sua teu tua voce vc nome chama tenho queria gostaria saber falar fala doutor doutora dr dra dentista name called " +
    "teeth tooth dental not know oi ola sim nao obrigado obrigada valeu tchau quero marcar agendar consulta preciso horario amanha segunda terca quarta quinta sexta sabado domingo por favor quanto custa"
  )
    .split(" ")
    // As palavras dos tratamentos ("Braces" não é um nome)
    .concat(SERVICES.flatMap((s) => [...s.words, ...s.wordsPt].flatMap((w) => w.split(" ")))),
);
const MAX_NAME_CHARS = 60;
/** "my name is X" vale em qualquer momento */
const MY_NAME = /^(?:(?:hi|hello|hey)[,!.]?\s+)?(?:my name is|my name's|call me|meu nome [eé]|me chamo)\s+(.+)$/i;
/** "I'm X" só logo depois do pedido de nome: fora dele, "I'm interested" não é um nome */
const I_AM = /^(?:(?:hi|hello|hey)[,!.]?\s+)?(?:i'm|i am|im|it's|its|this is|sou(?: o| a)?|eu sou)\s+(.+)$/i;

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
    .normalize("NFD").replace(/\p{M}/gu, "")
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

/**
 * O cliente escolhe por frase, como falaria com uma secretária ("quero sexta", "dia 10", "o primeiro", "esse", "o das 9"),
 * e a lista oferecida vira o número da opção. Só vale se a frase aponta para uma única opção.
 */
function pickOffered(t: string, options: SessionOption[], timeZone: string): number | null {
  if (options.length === 0) return null;
  if (THIS_ONE.test(t)) return options.length === 1 ? options[0].n : null;
  if (FIRST.test(t)) return options[0].n;
  if (LAST.test(t)) return options[options.length - 1].n;
  const days = options.filter((o): o is Extract<SessionOption, { kind: "day" }> => o.kind === "day");
  if (days.length === 0) return null;
  const weekday = t.split(" ").map((w) => WEEKDAYS[w]).find(Boolean);
  if (weekday) {
    const same = days.filter((o) => DateTime.fromISO(o.date, { zone: timeZone }).weekday === weekday);
    return same.length === 1 ? same[0].n : null;
  }
  const dayOfMonth = /\b(?:dia )?(\d{1,2})(?: de [a-z]+)?$/.exec(t)?.[1];
  if (dayOfMonth) {
    const same = days.filter((o) => DateTime.fromISO(o.date, { zone: timeZone }).day === Number(dayOfMonth));
    return same.length === 1 ? same[0].n : null;
  }
  return null;
}

/** Regras sem modelo (contracts/interpreter.md §1). null = deixar para o modelo. */
function byRules({ text, step, options, now, timeZone, window, awaitingName, awaitingReminder }: InterpretInput): Interpretation | null {
  const t = normalize(text);
  if (!t) return result("unclear");

  if (CHOOSING.includes(step) && /^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return options.some((o) => o.n === n) ? result("choose", { option: n }) : result("unclear");
  }
  if (step === "choose_slot" && (MORE.has(t) || (t.length <= 40 && WANTS_MORE.test(t) && !/\d/.test(t)))) return result("more");
  if (CHOOSING.includes(step) && t.length <= 40 && WANTS_OTHER_DAY.test(t) && !/\d/.test(t)) return result("other_day");
  if (CHOOSING.includes(step)) {
    const picked = pickOffered(t, options, timeZone);
    if (picked !== null) return result("choose", { option: picked });
  }
  if (step === "choose_slot") {
    // "the 10 am one", "2:30 pm": o horário citado, se estiver entre os oferecidos
    const spoken = /\bdas? (\d{1,2})(?: ?h|:(\d{2}))?\b/.exec(t);
    const minutes = parseTimeOfDay(text) ?? (spoken ? Number(spoken[1]) * 60 + Number(spoken[2] ?? 0) : null);
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

function systemPrompt({ step, options, now, timeZone, awaitingName, awaitingReminder }: InterpretInput, clinicName: string): string {
  const today = DateTime.fromJSDate(now, { zone: timeZone }).setLocale("en-US");
  const offered = options
    .map((o) => {
      if (o.kind === "day") return `${o.n}. ${formatDay(o.date, timeZone)} (${o.date})`;
      if (o.kind === "slot") return `${o.n}. ${formatTime(new Date(o.start), timeZone)}`;
      return `${o.n}. ${o.service}`;
    })
    .join("\n");
  return [
    `You classify WhatsApp messages sent to the scheduling assistant of ${clinicName}, a dental clinic.`,
    "Do NOT answer the customer. Return only the JSON object.",
    "The customer may write in English or Brazilian Portuguese.",
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
    '- choose: picks one of the offered options, by number, by its time ("the 10 am one") or by naming a day; set "option" to the number, or "date" when they name a day. Never use it when no options are on screen',
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
    'Rules: "date" is null unless the customer names a day or a date ("Friday", "tomorrow", "the 25th"); then it is YYYY-MM-DD computed from today\'s date. "I want to book an appointment" names no day, so its date is null: today is never a default. Only use "option" with a number from the list above, and never invent one. When in doubt, use unclear.',
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
  const { option, name } = parsed.data;
  let { date } = parsed.data;
  // "choose" só existe com opções na tela: sem elas, um dia citado é um pedido de agendamento (alguns modelos erram isso)
  const intent: Intent = parsed.data.intent === "choose" && options.length === 0 ? (date ? "book" : "unclear") : parsed.data.intent;

  // Uma data simples citada na frase vale mais que a calculada pelo modelo, que erra dias da semana
  const cited = findDatesInText(text, { now, timeZone });
  if (cited.length === 1 && ["book", "availability", "choose", "reschedule"].includes(intent)) date = cited[0];
  // Alguns modelos preenchem a data de hoje num pedido sem dia ("I want to book"): sem data na frase, hoje só vale se o cliente disse hoje
  const todayLocal = DateTime.fromJSDate(now, { zone: timeZone }).toISODate();
  if (date !== null && date === todayLocal && cited.length === 0 && ["book", "availability", "reschedule"].includes(intent) && !SAYS_TODAY.test(text)) {
    date = null;
  }

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

export function createInterpreter({ ollama, clinicName = "DentalSafe" }: { ollama: Pick<OllamaClient, "chat">; clinicName?: string }) {
  return {
    /** Lança InterpreterUnavailable se o modelo for necessário e o Ollama não responder. */
    async interpret(input: InterpretInput): Promise<Interpretation> {
      const ruled = byRules(input);
      if (ruled) return ruled;

      const raw = await ollama.chat({
        format: FORMAT,
        messages: [
          { role: "system", content: systemPrompt(input, clinicName) },
          ...input.history.slice(-HISTORY_LIMIT),
          { role: "user", content: input.text },
        ],
      });
      return validate(raw, input);
    },
  };
}

export type Interpreter = ReturnType<typeof createInterpreter>;
