/** Validação e limpeza da resposta do modelo contra a etapa, as opções na tela e a janela de datas (contracts/interpreter.md §3). */
import { DateTime } from "luxon";
import { z } from "zod";
import type { SessionOption } from "../../../db/schema.js";
import type { ServiceCatalog } from "../catalog.js";
import { findDatesInText, findExplicitDatesInText, namesTheWeekend, weekdaysNamedInText } from "../dates.js";
import { INTENTS, asksForWhen, canCarryAWhen, carriesACitedDay, isStepOnly, picksOfferedDay, type Intent } from "../intents.js";
import { normalize } from "../understanding/quote.js";
import { cleanName, nameInText } from "./names.js";
import { WEEKDAY_NAMES } from "./prompt.js";
import { NO, YES } from "./rules.js";
import { result, type InterpretInput, type Interpretation } from "./types.js";

/** O cliente fala de hoje: só então a data de hoje, devolvida pelo modelo num pedido sem dia, vale */
const SAYS_TODAY = /\b(today|tonight|now|this (?:morning|afternoon|evening))\b/i;

/** Saída da pergunta focada: só o tratamento citado, ou null */
// A citação é o trecho que o cliente escreveu e que menciona o tratamento: o código confere que ele está na conversa
export const mentionOutput = z.object({ quote: z.string().nullable(), service: z.string().nullable() });

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

/** Valida a saída do modelo contra a etapa e a janela de datas (contracts/interpreter.md §3). */
export function validate(raw: unknown, { text, step, options, window, now, timeZone, awaitingName }: InterpretInput, catalog: ServiceCatalog): Interpretation {
  const askedName = awaitingName || step === "ask_name";
  const parsed = modelOutput.safeParse(raw);
  if (!parsed.success) return result("unclear", { source: "model" });
  const { name } = parsed.data;
  // O fim de semana é sábado e domingo juntos: o modelo o diz como "weekend", ou a frase traz os dois dias pelo nome
  const namedDays = weekdaysNamedInText(text);
  const weekendAsked = parsed.data.weekday === "weekend" || namesTheWeekend(text);
  const weekday = parsed.data.weekday && parsed.data.weekday !== "weekend" ? WEEKDAY_NAMES.indexOf(parsed.data.weekday) + 1 : 0;
  let { option, date } = parsed.data;
  // O horário citado só vale no formato HH:MM de 24 h; um valor que o modelo inventou fora disso some
  const time = parsed.data.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.data.time) && canCarryAWhen(parsed.data.intent) ? parsed.data.time : null;
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
  const pickedDay = weekendAsked ? undefined : offeredDayPicked(parsed.data.intent, { weekday: weekdayCited, citedDates, explicitDates, modelDate: parsed.data.date ?? null, hasExplicitDate, offeredDays, timeZone });
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
  let intent: Intent = parsed.data.intent === "choose" && options.length === 0 ? (date ? "book" : weekend ? "availability" : "unclear") : parsed.data.intent;
  if (pickedDay) intent = "choose";
  // Na lista de dias, citar um dia ("e domingo?") é escolher esse dia, mesmo que o modelo tenha visto aí um "outro dia"
  if (intent === "other_day" && (option !== null || fromWeekday)) intent = "choose";

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
  if (intent === "choose") {
    if (option !== null && !options.some((o) => o.n === option)) return result("unclear", { source: "model" });
    if (option === null && date === null && time === null && !weekend) return result("unclear", { source: "model" });
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
    ...(intent === "needs_staff" ? { urgent: parsed.data.urgent === true } : {}),
    source: "model",
    ...(date && date > window.lastDate ? { tooFar: true } : {}),
  };
}
