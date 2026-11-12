/** Regras sem modelo (contracts/interpreter.md §1): as respostas curtas e as etapas que dispensam o modelo. */
import type { SchedulingStep } from "../../../db/schema.js";
import type { ServiceCatalog } from "../catalog.js";
import { minutesOfDay, namesTheWeekend, parseSimpleDate, parseTimeOfDay } from "../dates.js";
import { normalize } from "../understanding/quote.js";
import { cleanName, MY_NAME } from "./names.js";
import { result, type InterpretInput, type Interpretation } from "./types.js";

export const YES = new Set(["yes", "y", "yeah", "yep", "yup", "sure", "ok", "okay", "confirm", "confirmed", "correct", "sim", "yes please", "ok thanks", "claro", "pode ser", "com certeza", "confirmo", "isso"]);
export const NO = new Set(["no", "n", "nope", "not", "nao", "não", "no thanks", "no thank you", "nao quero", "de jeito nenhum"]);
/** Respostas ao lembrete que também confirmam presença (normalizadas: sem apóstrofo nem pontuação) */
const ATTENDING = new Set(["i ll be there", "ill be there", "i will be there", "see you", "see you there", "see you then", "yes i ll be there", "yes confirmed", "confirmed thanks", "yes thanks"]);
const MORE = new Set(["more", "more options", "others", "other times", "more times", "show more", "anything else", "mais", "mais horarios", "outros horarios"]);
const OTHER_DAY = new Set(["other day", "another day", "different day", "other date", "another date", "a different day", "outro dia", "outra data", "outro dia por favor", "outra data por favor"]);
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

/** Regras sem modelo (contracts/interpreter.md §1). null = deixar para o modelo. */
export function byRules({ text, step, options, now, timeZone, window, awaitingReminder }: InterpretInput, catalog: ServiceCatalog): Interpretation | null {
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
  // Serviço (specs/005): o número na lista é conta; o nome do tratamento quem lê é o modelo, que vê a conversa
  if (step === "choose_service" && /^\d{1,2}$/.test(t)) {
    const service = catalog.byNumber(Number(t));
    return service ? result("choose_service", { service }) : result("unclear");
  }
  if (step === null || CHOOSING.includes(step)) {
    const date = parseSimpleDate(text, { now, timeZone });
    // Numa lista de dias, uma data que não está na lista é do modelo e do validate: um dia da semana citado ("quarta") cai em hoje aqui, e o dia oferecido com esse nome é o certo
    const listed = step !== "choose_day" || options.some((o) => o.kind === "day" && o.date === date);
    // Sábado e domingo juntos não são uma data só: o fim de semana é do modelo e do validate
    if (date && listed && !namesTheWeekend(text)) {
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
  return null;
}
