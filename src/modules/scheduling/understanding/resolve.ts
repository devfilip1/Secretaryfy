import type { SchedulingStep } from "../../../db/schema.js";
import type { Interpretation, When } from "../interpret.js";
import { asksForWhen, isChoiceLike, mayBeNoise, type Intent } from "../intents.js";
import type { Agreement } from "./agreement.js";

/** Quando a chamada focada de horário/parte do dia/dia deve rodar */
export function wantsWhen(interpretation: Interpretation, step: SchedulingStep | null | undefined): boolean {
  // O horário citado ("as 14h"): o campo do interpretador vem às vezes vazio, então uma chamada focada o procura (ADR 0015)
  return (
    asksForWhen(interpretation.intent) ||
    (interpretation.intent === "choose" && (interpretation.option === null || step === "choose_slot")) ||
    step === "choose_slot"
  );
}

/**
 * Junta a chamada focada à interpretação: período vence horário inventado; chamada que rodou (namesDay booleano) manda no horário;
 * data sem dia citado some (e tooFar some junto); com horários na tela (step choose_slot) horário ou período vira escolha.
 * Devolve o mesmo objeto quando nada muda.
 */
export function applyWhen(interpretation: Interpretation, when: When | null, step: SchedulingStep | null | undefined): Interpretation {
  // O que a frase pede no tempo ("as 14h", "de manhã"): a parte do dia vence um horário que o modelo tenha inventado ("de manhã" não é 09:00), e então não há horário
  const period = when?.period ?? null;
  // A chamada focada confere a citação no texto, então vale mais que o campo do modelo principal (que às vezes inventa um horário);
  // se ela falhou (namesDay não é verdadeiro nem falso), o campo do modelo vale
  const focused = typeof when?.namesDay === "boolean";
  const time = period ? null : focused ? (when?.time ?? null) : (when?.time ?? interpretation.time ?? null);
  // A data que o modelo deu sem a mensagem citar nenhum dia é chute ("e à noite, tem?" virou um sábado): some, e o dia da tela vale
  const invented = when?.namesDay === false && interpretation.date !== null;
  const read = invented ? { ...interpretation, date: null, tooFar: undefined } : interpretation;
  // Com os horários na tela, um horário ou uma parte do dia ("prefiro à noite") é uma escolha dentro do dia da tela, mesmo que o modelo tenha lido "mais", "não entendi" ou "outro dia"
  const toChoice = Boolean((time || period) && step === "choose_slot" && isChoiceLike(interpretation.intent));
  const changed = time !== (interpretation.time ?? null) || Boolean(period) || invented;
  if (!changed) return interpretation;
  return { ...read, time, period, ...(toChoice ? { intent: "choose" as const, option: null } : {}) };
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
    !interpretation.date
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
