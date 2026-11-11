/** Validação e limpeza da resposta do modelo contra a etapa, as opções na tela e a janela de datas (contracts/interpreter.md §3). */
import { DateTime } from "luxon";
import { z } from "zod";
import type { SessionOption } from "../../../db/schema.js";
import type { ServiceCatalog } from "../catalog.js";
import { findDatesInText } from "../dates.js";
import { INTENTS, asksForWhen, canCarryAWhen, isStepOnly, picksOfferedDay, type Intent } from "../intents.js";
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

/** Valida a saída do modelo contra a etapa e a janela de datas (contracts/interpreter.md §3). */
export function validate(raw: unknown, { text, step, options, window, now, timeZone, awaitingName }: InterpretInput, catalog: ServiceCatalog): Interpretation {
  const askedName = awaitingName || step === "ask_name";
  const parsed = modelOutput.safeParse(raw);
  if (!parsed.success) return result("unclear", { source: "model" });
  const { name } = parsed.data;
  // O fim de semana conta como sábado: a aritmética da data é do código
  const weekday = parsed.data.weekday === "weekend" ? 6 : parsed.data.weekday ? WEEKDAY_NAMES.indexOf(parsed.data.weekday) + 1 : 0;
  let { option, date } = parsed.data;
  // O horário citado só vale no formato HH:MM de 24 h; um valor que o modelo inventou fora disso some
  const time = parsed.data.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.data.time) && canCarryAWhen(parsed.data.intent) ? parsed.data.time : null;
  // O modelo entende o dia da semana em qualquer forma ("sábados", "sab") e devolve só o número; a conta do calendário é do código
  const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  let fromWeekday = false;
  if (weekday) {
    const offeredDays = options.filter((o): o is Extract<SessionOption, { kind: "day" }> => o.kind === "day");
    const same = offeredDays.filter((o) => DateTime.fromISO(o.date, { zone: timeZone }).weekday === weekday);
    // O dia citado vale mais que a opção que o modelo marcou junto ("fim de semana?" na lista de dias não é a opção 1)
    if (picksOfferedDay(parsed.data.intent) && same.length === 1) option = same[0].n;
    else if (findDatesInText(text, { now, timeZone }).length === 0) {
      // O próximo dia com esse nome, contando hoje; a data que o modelo calculou erra o dia da semana
      date = today.plus({ days: (weekday - today.weekday + 7) % 7 }).toISODate();
      fromWeekday = true;
      option = null;
    }
  }
  // "choose" só existe com opções na tela: sem elas, um dia citado é um pedido de agendamento (alguns modelos erram isso)
  let intent: Intent = parsed.data.intent === "choose" && options.length === 0 ? (date ? "book" : "unclear") : parsed.data.intent;
  // Na lista de dias, citar um dia ("e domingo?") é escolher esse dia, mesmo que o modelo tenha visto aí um "outro dia"
  if (intent === "other_day" && (option !== null || fromWeekday)) intent = "choose";

  // Uma data simples citada na frase vale mais que a calculada pelo modelo, que erra dias da semana
  const cited = findDatesInText(text, { now, timeZone });
  if (cited.length === 1 && canCarryAWhen(intent)) date = cited[0];
  // Alguns modelos preenchem a data de hoje num pedido sem dia ("I want to book"): sem data na frase, hoje só vale se o cliente disse hoje
  const todayLocal = DateTime.fromJSDate(now, { zone: timeZone }).toISODate();
  if (date !== null && !fromWeekday && date === todayLocal && cited.length === 0 && asksForWhen(intent) && !SAYS_TODAY.test(text)) {
    date = null;
  }

  if (date !== null) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && DateTime.fromISO(date).isValid;
    if (!valid || date < window.firstDate) return result("unclear", { source: "model" });
  }
  if (intent === "choose") {
    if (option !== null && !options.some((o) => o.n === option)) return result("unclear", { source: "model" });
    if (option === null && date === null && time === null) return result("unclear", { source: "model" });
  } else if (!asksForWhen(intent)) {
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
    ...(intent === "needs_staff" ? { urgent: parsed.data.urgent === true } : {}),
    source: "model",
    ...(date && date > window.lastDate ? { tooFar: true } : {}),
  };
}
