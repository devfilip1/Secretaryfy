import type { SchedulingStep } from "../../../db/schema.js";
import type { Interpretation, When } from "../interpret.js";
import { asksForWhen, isChoiceLike, mayBeNoise, type Intent } from "../intents.js";
import type { Agreement } from "./agreement.js";
import { findExplicitDatesInText, namesTheWeekend, weekdaysNamedInText } from "../dates.js";

/** Quando a chamada focada de horário/parte do dia/dia deve rodar; com uma janela também, pois ela diz se a janela é o pedido */
export function wantsWhen(interpretation: Interpretation, step: SchedulingStep | null | undefined): boolean {
  // O horário citado ("as 14h"): o campo do interpretador vem às vezes vazio, então uma chamada focada o procura (ADR 0015)
  return (
    asksForWhen(interpretation.intent) ||
    (interpretation.intent === "choose" && (interpretation.option === null || step === "choose_slot")) ||
    step === "choose_slot"
  );
}

/**
 * A chamada focada achou um período, um horário ou um dia citado: a frase é um pedido de mudança ("melhor de manhã"), não um sim ou não
 * de confirmação, então a intenção do modelo segue e applyWhen a aplica.
 */
export function citesWhen(when: When | null): boolean {
  return Boolean(when?.period || when?.time || when?.namesDay === true || when?.weekend === true);
}

/** A frase e a data de hoje: a chamada focada diz o fim de semana, e aqui se confere se a frase cita um dia */
export interface WhenInput {
  text: string;
  now: Date;
  timeZone: string;
}

/** A chamada focada disse o fim de semana, e a frase não cita data nem um dia da semana sozinho ("sábado e domingo" conta como fim de semana) */
function asksTheWeekend(when: When | null, input: WhenInput): boolean {
  if (when?.weekend !== true) return false;
  if (findExplicitDatesInText(input.text, input).length > 0) return false;
  const days = weekdaysNamedInText(input.text);
  return days.length === 0 || namesTheWeekend(input.text);
}

/**
 * Junta a chamada focada à interpretação. Uma janela que a frase pede (bound: "antes das 11", "mais tarde") fica, e o horário ou a
 * parte do dia da chamada não a mudam. Horário exato ou parte do dia dita sem limite tira a janela que o modelo pôs junto.
 * Período vence horário inventado; chamada que rodou (namesDay booleano) manda no horário; data sem dia citado some (e tooFar some
 * junto); com horários na tela (step choose_slot) horário ou período vira escolha. Devolve o mesmo objeto quando nada muda.
 */
export function applyWhen(interpretation: Interpretation, when: When | null, step: SchedulingStep | null | undefined, input: WhenInput): Interpretation {
  if (interpretation.timeWindow && when?.bound === true) return interpretation;
  // O que a frase pede no tempo ("as 14h", "de manhã"): a parte do dia vence um horário que o modelo tenha inventado ("de manhã" não é 09:00), e então não há horário
  const period = when?.period ?? null;
  // A chamada focada confere a citação no texto, então vale mais que o campo do modelo principal (que às vezes inventa um horário);
  // se ela falhou (namesDay não é verdadeiro nem falso), o campo do modelo vale
  const focused = typeof when?.namesDay === "boolean";
  const time = period ? null : focused ? (when?.time ?? null) : (when?.time ?? interpretation.time ?? null);
  // Horário exato ou parte do dia dita sem limite não é janela ("às 14h", "de manhã"): a janela que o modelo pôs junto some
  const fromCall = focused && Boolean(time || period);
  const unwindowed = fromCall && interpretation.timeWindow ? { ...interpretation, timeWindow: null } : interpretation;
  // A data que o modelo deu sem a mensagem citar nenhum dia é chute ("e à noite, tem?" virou um sábado): some, e o dia da tela vale
  const invented = when?.namesDay === false && interpretation.date !== null;
  const read = invented ? { ...unwindowed, date: null, tooFar: undefined } : unwindowed;
  // Com os horários na tela, um horário ou uma parte do dia ("prefiro à noite") é uma escolha dentro do dia da tela, mesmo que o modelo tenha lido "mais", "não entendi" ou "outro dia"
  const toChoice = Boolean((time || period) && step === "choose_slot" && isChoiceLike(interpretation.intent));
  // O fim de semana inteiro sem dia citado: a data que o modelo deu é chute, e a opção da tela não vale
  const weekend = asksTheWeekend(when, input);
  const weekendChanged = weekend && (interpretation.weekend !== true || interpretation.date !== null || interpretation.option !== null || interpretation.intent === "unclear");
  const changed = time !== (interpretation.time ?? null) || Boolean(period) || invented || unwindowed !== interpretation || weekendChanged;
  if (!changed) return interpretation;
  const next = { ...read, time, period, ...(toChoice ? { intent: "choose" as const, option: null } : {}) };
  if (!weekend) return next;
  // "não entendi" sobre o fim de semana vira disponibilidade: a pergunta é de horários, e o fluxo oferece sábado e domingo
  return { ...next, date: null, option: null, tooFar: undefined, weekend: true, intent: next.intent === "unclear" ? "availability" : next.intent };
}

/**
 * "the first one": com opções na tela e sem horário, período ou dia na frase, quem acha a posição é a chamada focada, que confere a citação
 * no texto. Isso vale também quando o modelo principal já trouxe uma opção: ele a inventa para "sim, pode ser" (virou a "quinta").
 */
export function needsPick(interpretation: Interpretation, optionCount: number): boolean {
  return (
    optionCount > 0 &&
    (interpretation.intent === "choose" || interpretation.intent === "unclear") &&
    // Uma opção da regra (o cliente digitou "2") já é fato; só a do modelo principal precisa de conferência
    (interpretation.option === null || interpretation.source === "model") &&
    !interpretation.time &&
    !interpretation.period &&
    !interpretation.date &&
    !interpretation.weekend
  );
}

/**
 * Preenche a opção achada (a intenção vira choose). Sem posição citada, uma opção que só o modelo principal deu não vale: vira "não entendi".
 * Sem opção nenhuma, devolve o mesmo objeto.
 */
export function applyPick(interpretation: Interpretation, pick: number | null): Interpretation {
  if (pick) return { ...interpretation, intent: "choose" as const, option: pick };
  return interpretation.option === null ? interpretation : { ...interpretation, intent: "unclear" as const, option: null };
}

/** Quando a chamada de sentido deve rodar: só para intenções que podem ser palavras sem sentido (ver mayBeNoise) */
export function wantsSense(interpretation: Interpretation): boolean {
  return mayBeNoise(interpretation.intent);
}

/**
 * Palavras sem sentido lidas como grosseria, manipulação ou fora do assunto viram não entendi; o resto fica.
 * Só rebaixa: nunca troca outra intenção, e devolve o mesmo objeto quando nada muda.
 */
export function applySense(interpretation: Interpretation, makesNoSense: boolean | null): Interpretation {
  if (makesNoSense !== true || !mayBeNoise(interpretation.intent)) return interpretation;
  return { ...interpretation, intent: "unclear" as const };
}

/** Intenção que vira resposta de sim ou não: a resposta limpa os campos que o modelo inventou para a pergunta */
const answered = (interpretation: Interpretation, intent: Intent): Interpretation => ({
  ...interpretation,
  intent,
  option: null,
  date: null,
  time: null,
  topicOnly: false,
});

/**
 * Sim ou não numa confirmação, quando a intenção só repetia o assunto da pergunta (topicOnly, ver validate.ts): concordância vira sim
 * e recusa vira não. Sem resposta clara (neither ou falha), a intenção do modelo fica, mas nunca vira sim; no cancelamento, que apaga
 * o horário, vira não entendi, para o assistente perguntar de novo. Devolve o mesmo objeto quando a intenção não é só o assunto.
 */
export function applyAgreement(interpretation: Interpretation, step: SchedulingStep | null, agreement: Agreement | null): Interpretation {
  if (!interpretation.topicOnly) return interpretation;
  if (agreement === "agree") return answered(interpretation, "yes");
  if (agreement === "refuse") return answered(interpretation, "no");
  return step === "confirm_cancel" ? answered(interpretation, "unclear") : interpretation;
}
