/** Validação e limpeza da resposta do modelo contra a etapa, as opções na tela e a janela de datas (contracts/interpreter.md §3). */
import { DateTime } from "luxon";
import { z } from "zod";
import type { SchedulingStep, SessionOption } from "../../../db/schema.js";
import type { ServiceCatalog } from "../catalog.js";
import { findDatesInText, findExplicitDatesInText, namesTheWeekend, parseTimeOfDay, weekdaysNamedInText } from "../dates.js";
import { INTENTS, asksForWhen, canCarryAWhen, canFilterTime, carriesACitedDay, isStepOnly, picksOfferedDay, type Intent } from "../intents.js";
import { normalize } from "../understanding/quote.js";
import { cleanName, nameInText } from "./names.js";
import { WEEKDAY_NAMES } from "./prompt.js";
import { NO, YES } from "./rules.js";
import { result, type InterpretInput, type Interpretation, type TimeWindow } from "./types.js";

/** Assunto de cada pergunta de sim ou não: a intenção que só repete esse assunto é a própria pergunta, não um pedido novo */
const YES_NO_TOPIC: Partial<Record<SchedulingStep, Intent>> = {
  confirm_booking: "book",
  confirm_cancel: "cancel",
  confirm_reschedule: "reschedule",
  offer_reschedule: "reschedule",
};

/** O cliente fala de hoje: só então a data de hoje, devolvida pelo modelo num pedido sem dia, vale */
const SAYS_TODAY = /\b(today|tonight|now|this (?:morning|afternoon|evening))\b/i;

/** Saída da pergunta focada: só o tratamento citado, ou null */
// A citação é o trecho que o cliente escreveu e que menciona o tratamento: o código confere que ele está na conversa
export const mentionOutput = z.object({ quote: z.string().nullable(), service: z.string().nullable() });

/** Janela de horários como o modelo a devolve (cada ponta é HH:MM, first, last ou null); validWindow confere */
const windowOutput = z.object({
  after: z.string().nullable().optional(),
  before: z.string().nullable().optional(),
  near: z.string().nullable().optional(),
  pick: z.enum(["earliest", "latest"]).nullable().optional(),
});

const modelOutput = z.object({
  intent: z.enum(INTENTS),
  // Campos que o modelo só preenche quando a mensagem os traz: ausente é o mesmo que null
  option: z.number().int().nullable().default(null),
  date: z.string().nullable().default(null),
  time: z.string().nullable().optional(),
  weekday: z.enum([...WEEKDAY_NAMES, "weekend"]).nullable().optional(),
  urgent: z.boolean().optional(),
  name: z.string().nullable().default(null),
  service: z.string().nullable().optional(),
  timeWindow: windowOutput.nullable().optional(),
});

type OfferedDay = Extract<SessionOption, { kind: "day" }>;

/**
 * O dia da lista na tela que o cliente escolheu. Uma data citada na frase que é um dos dias oferecidos é a escolha; sem ela,
 * o dia da semana citado é o primeiro dia oferecido com esse nome. Vale para as intenções que podem escolher um dia (sim e
 * não nunca escolhem). Uma data citada que não é a da semana ("quarta dia 25", fora da lista) não é o dia da lista.
 */
function offeredDayPicked(
  intent: Intent,
  { weekday, citedDates, explicitDates, modelDate, hasExplicitDate, offeredDays, timeZone }: { weekday: number; citedDates: string[]; explicitDates: string[]; modelDate: string | null; hasExplicitDate: boolean; offeredDays: OfferedDay[]; timeZone: string },
): OfferedDay | undefined {
  if (!picksOfferedDay(intent) || offeredDays.length === 0) return undefined;
  // Data escrita ("dia 25") vale mais que o dia da semana na mesma frase ("quinta"): quem diz as duas quer a data
  const explicit = citedDates.filter((d) => explicitDates.includes(d));
  const candidates = explicit.length > 0 ? explicit : citedDates;
  // Duas datas na frase ("não é dia 19, é dia 25"): vale a que o modelo escolheu; sem isso, a última, que é onde se põe a correção
  const wanted = modelDate && candidates.includes(modelDate) ? [modelDate] : [...candidates].reverse();
  const byDate = wanted.map((d) => offeredDays.find((o) => o.date === d)).find(Boolean);
  if (byDate) return byDate;
  if (!weekday || hasExplicitDate) return undefined;
  return offeredDays.find((o) => DateTime.fromISO(o.date, { zone: timeZone }).weekday === weekday);
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Uma ponta da janela: HH:MM, ou first/last só com a tela de horários; o resto é nulo */
function windowEnd(value: string | null | undefined, onScreen: boolean): string | null {
  if (!value) return null;
  if (value === "first" || value === "last") return onScreen ? value : null;
  return TIME_OF_DAY.test(value) ? value : null;
}

/** Janela válida: formato, antes < depois quando as duas são horários, e um dia para ela; sem isso, nula */
function validWindow(
  raw: z.infer<typeof windowOutput> | null | undefined,
  { onScreen, hasDay, timed }: { onScreen: boolean; hasDay: boolean; timed: boolean },
): TimeWindow | null {
  if (!raw || !hasDay) return null;
  const notBefore = windowEnd(raw.after, onScreen);
  const notAfter = windowEnd(raw.before, onScreen);
  // Um horário exato vai pelo caminho dele (askedTime): a proximidade só vale sem ele
  const near = timed ? null : windowEnd(raw.near, onScreen);
  const pick = raw.pick ?? null;
  if (notBefore && notAfter && TIME_OF_DAY.test(notBefore) && TIME_OF_DAY.test(notAfter) && notBefore >= notAfter) return null;
  if (!notBefore && !notAfter && !near && !pick) return null;
  return { notBefore, notAfter, near, pick };
}

/** Valida a saída do modelo contra a etapa e a janela de datas (contracts/interpreter.md §3). */
export function validate(raw: unknown, { text, step, options, window, now, timeZone, awaitingName }: InterpretInput, catalog: ServiceCatalog): Interpretation {
  const askedName = awaitingName || step === "ask_name";
  const parsed = modelOutput.safeParse(raw);
  if (!parsed.success) return result("unclear", { source: "model" });
  const { name } = parsed.data;
  // Uma janela de horários dita numa etapa de escolha é um pedido de horário, mesmo que o modelo a tenha lido como pergunta:
  // a pergunta é só informação da clínica, e a janela só existe porque o cliente falou dos horários na tela
  const modelIntent: Intent = parsed.data.intent === "question" && step !== null && parsed.data.timeWindow ? "availability" : parsed.data.intent;
  // O fim de semana é sábado e domingo juntos: o modelo o diz como "weekend", ou a frase traz os dois dias pelo nome. Se a frase nomeia algum dia e não os dois, o "weekend" do modelo é engano ("segunda de tarde" não é o fim de semana; "sábado" é só o sábado)
  const namedDays = weekdaysNamedInText(text);
  const weekendAsked = namedDays.length > 0 ? namesTheWeekend(text) : parsed.data.weekday === "weekend";
  const weekday = parsed.data.weekday && parsed.data.weekday !== "weekend" ? WEEKDAY_NAMES.indexOf(parsed.data.weekday) + 1 : 0;
  let { option, date } = parsed.data;
  // O horário citado só vale no formato HH:MM de 24 h; um valor que o modelo inventou fora disso some
  let time = parsed.data.time &&/^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.data.time) && canCarryAWhen(parsed.data.intent) ? parsed.data.time : null;
  // Disponibilidade com uma ponta de janela ("antes das 10"): a janela é o pedido, e o horário que o modelo puser junto (muitas vezes a ponta, às vezes outro) não é um horário exato
  const hasBound = !!parsed.data.timeWindow && (!!parsed.data.timeWindow.before || !!parsed.data.timeWindow.after);
  if (modelIntent === "availability" && hasBound) time = null;
  // O modelo entende o dia da semana em qualquer forma ("sábados", "sab") e devolve só o número; a conta do calendário é do código
  const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  const offeredDays = options.filter((o): o is OfferedDay => o.kind === "day");
  const citedDates = findDatesInText(text, { now, timeZone });
  // O dia dito pelo nome na frase ("quarta feira") vale mais que o dia da semana do modelo, que erra o nome (devolveu quinta); com data explícita, vale o do modelo
  const explicitDates = findExplicitDatesInText(text, { now, timeZone });
  const hasExplicitDate = explicitDates.length > 0;
  const weekdayCited = weekendAsked ? 0 : hasExplicitDate ? weekday : (namedDays[0] ?? weekday);
  // O próximo dia com esse nome, contando hoje; a data que o modelo calculou erra o dia da semana
  const nextWithThatName = weekdayCited ? today.plus({ days: (weekdayCited - today.weekday + 7) % 7 }).toISODate() : null;
  // O dia da lista que o cliente escolheu vale mais que a opção que o modelo marcou ("fim de semana?" na lista não é a opção 1)
  // Sábado e domingo juntos não escolhem um dia da lista (a escolha é do fim de semana inteiro)
  const pickedDay = weekendAsked ? undefined : offeredDayPicked(modelIntent, { weekday: weekdayCited, citedDates, explicitDates, modelDate: parsed.data.date ?? null, hasExplicitDate, offeredDays, timeZone });
  // Data citada na frase que não é um dia da lista ("dia 25 de dezembro" com novembro na tela): a opção que o modelo marcou não vale
  if (!pickedDay && hasExplicitDate) option = null;
  let fromWeekday = false;
  if (pickedDay) {
    option = pickedDay.n;
    date = pickedDay.date;
  } else if (nextWithThatName && citedDates.length === 0) {
    date = nextWithThatName;
    fromWeekday = true;
    option = null;
  }
  // Fim de semana sem data citada: nem a data que o modelo inventou vale; o fluxo oferece sábado e domingo
  // (os nomes dos dias não são datas citadas: "sábado e domingo" vira duas datas em findDatesInText, e ainda é o fim de semana)
  const weekend = weekendAsked && !hasExplicitDate;
  if (weekend) {
    date = null;
    option = null;
  }
  // "choose" só existe com opções na tela: sem elas, um dia citado é um pedido de agendamento (alguns modelos erram isso)
  let intent: Intent = modelIntent === "choose" && options.length === 0 ? (date ? "book" : weekend ? "availability" : "unclear") : modelIntent;
  if (pickedDay) intent = "choose";
  // Na lista de dias, citar um dia ("e domingo?") é escolher esse dia, mesmo que o modelo tenha visto aí um "outro dia"
  if (intent === "other_day" && (option !== null || fromWeekday)) intent = "choose";
  // Sim ou não numa confirmação: a intenção que só repete o assunto da pergunta ("remarcar" num "pode sim") é um sim, salvo se
  // a frase cita um dia, horário, opção ou tratamento (aí é um pedido de mudança). Quem diz o tratamento tem de dizê-lo na frase
  const topic = step ? YES_NO_TOPIC[step] : undefined;
  const namedService = !!parsed.data.service && normalize(text).includes(normalize(parsed.data.service));
  const citesAWhen = citedDates.length > 0 || namedDays.length > 0 || weekendAsked || parseTimeOfDay(text) !== null || option !== null || namedService;
  // Sem nada citado, o modelo só repetiu o assunto: se a frase é sim, não ou outra coisa, quem diz é a chamada de concordância (topicOnly).
  // A intenção fica a do modelo; aqui não se decide sim nem não
  const topicOnly = intent === topic && !citesAWhen;
  if (topicOnly) {
    date = null;
    option = null;
    time = null;
  }

  // Uma data simples citada na frase vale mais que a calculada pelo modelo, que erra dias da semana (o dia escolhido da lista já é uma data citada)
  if (!pickedDay && citedDates.length === 1 && canCarryAWhen(intent)) date = citedDates[0];
  // "Outro dia" e "mais" levam só a data citada na frase (a última, se são duas: a correção); sem ela, nenhuma data do modelo vale
  if (!pickedDay && carriesACitedDay(intent)) date = date !== null && citedDates.includes(date) ? date : (citedDates.at(-1) ?? null);
  // Alguns modelos preenchem a data de hoje num pedido sem dia ("I want to book"): sem data na frase, hoje só vale se o cliente disse hoje
  const todayLocal = DateTime.fromJSDate(now, { zone: timeZone }).toISODate();
  if (date !== null && !fromWeekday && date === todayLocal && citedDates.length === 0 && asksForWhen(intent) && !SAYS_TODAY.test(text)) {
    date = null;
  }

  if (date !== null) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && DateTime.fromISO(date).isValid;
    if (!valid || date < window.firstDate) return result("unclear", { source: "model" });
  }
  // A janela vale com um dia: o da frase, ou o dos horários na tela (na etapa de horários); sem opção escolhida
  const onScreenTimes = step === "choose_slot" && options.some((o) => o.kind === "slot");
  const timeWindow =
    canFilterTime(intent) && option === null && !weekend
      ? validWindow(parsed.data.timeWindow, { onScreen: onScreenTimes, hasDay: date !== null || step === "choose_slot", timed: time !== null })
      : null;
  if (intent === "choose") {
    if (option !== null && !options.some((o) => o.n === option)) return result("unclear", { source: "model" });
    if (option === null && date === null && time === null && !weekend && timeWindow === null) return result("unclear", { source: "model" });
  } else if (!asksForWhen(intent) && !carriesACitedDay(intent)) {
    date = null;
  }
  // Logo depois do pedido de nome, o nome pode vir junto de qualquer intenção ("I'm Maria, how much is…?")
  const keepsName = askedName || intent === "give_name" || intent === "book";
  // O nome tem de estar escrito na mensagem e nunca vem de uma pergunta ("Qual seu nome?" e "voces aceitam cartão?" não são nomes)
  let cleaned = keepsName ? cleanName(name) : null;
  if (cleaned && (!nameInText(cleaned, text) || text.includes("?"))) cleaned = null;
  // "sim" e "não" respondem a uma pergunta, não são um nome (o modelo as devolve como nome logo depois do pedido)
  if (cleaned && (YES.has(normalize(cleaned)) || NO.has(normalize(cleaned)))) cleaned = null;
  if (intent === "give_name" && !cleaned) return result("unclear", { source: "model" });
  // O serviço tem de ser do catálogo: o rótulo que o modelo devolveu vira o nome guardado (byLabel, sem busca aproximada)
  const service = parsed.data.service ? catalog.byLabel(parsed.data.service) : null;
  // Logo depois do pedido, o nome escrito vale mais que uma intenção que não serve: sem etapa, escolher opção ou serviço não existe
  // ("pode me chamar de Bia" lido como serviço ou como outro dia)
  // A mensagem que é só o nome ("Juliana") é dar o nome, mesmo que o modelo a tenha lido como pergunta
  const onlyName = cleaned !== null && normalize(text) === normalize(cleaned);
  const outOfPlace = onlyName || intent === "unclear" || (step === null && isStepOnly(intent)) || (intent === "choose_service" && !service);
  if (askedName && cleaned && outOfPlace) {
    return result("give_name", { name: cleaned, source: "model" });
  }
  if (intent === "choose_service" && !service) return result("unclear", { source: "model" });
  return {
    intent,
    option: intent === "choose" ? option : null,
    date,
    ...(time ? { time } : {}),
    name: cleaned,
    ...(service ? { service } : {}),
    ...(weekend ? { weekend: true } : {}),
    ...(timeWindow ? { timeWindow } : {}),
    ...(topicOnly ? { topicOnly: true } : {}),
    ...(intent === "needs_staff" ? { urgent: parsed.data.urgent === true } : {}),
    source: "model",
    ...(date && date > window.lastDate ? { tooFar: true } : {}),
  };
}
