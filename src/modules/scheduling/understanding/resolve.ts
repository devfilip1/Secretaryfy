import type { Interpretation, When } from "../interpret.js";

/** Intenções que pedem horário ou dia (a conta do roteador: lista de intenções + escolha sem opção + etapa de horários) */
const TIME_INTENTS: Interpretation["intent"][] = ["book", "availability", "reschedule"];
/** Com os horários na tela, estas intenções viram escolha quando o cliente cita um horário ou uma parte do dia */
const CHOICE_INTENTS: Interpretation["intent"][] = ["more", "unclear", "other_day", "availability"];

/** Quando a chamada focada de horário/parte do dia/dia deve rodar */
export function wantsWhen(interpretation: Interpretation, step: string | null | undefined): boolean {
  // O horário citado ("as 14h"): o campo do interpretador vem às vezes vazio, então uma chamada focada o procura (ADR 0015)
  return (
    TIME_INTENTS.includes(interpretation.intent) ||
    (interpretation.intent === "choose" && (interpretation.option === null || step === "choose_slot")) ||
    step === "choose_slot"
  );
}

/**
 * Junta a chamada focada à interpretação: período vence horário inventado; chamada que rodou (namesDay booleano) manda no horário;
 * data sem dia citado some (e tooFar some junto); com horários na tela (step choose_slot) horário ou período vira escolha.
 * Devolve o mesmo objeto quando nada muda.
 */
export function applyWhen(interpretation: Interpretation, when: When | null, step: string | null | undefined): Interpretation {
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
  const toChoice = Boolean((time || period) && step === "choose_slot" && CHOICE_INTENTS.includes(interpretation.intent));
  const changed = time !== (interpretation.time ?? null) || Boolean(period) || invented;
  if (!changed) return interpretation;
  return { ...read, time, period, ...(toChoice ? { intent: "choose" as const, option: null } : {}) };
}

/** "the first one": com opções na tela e nenhuma lida, vale perguntar a posição que o cliente escolheu */
export function needsPick(interpretation: Interpretation, optionCount: number): boolean {
  return (
    optionCount > 0 &&
    (interpretation.intent === "choose" || interpretation.intent === "unclear") &&
    interpretation.option === null &&
    !interpretation.time &&
    !interpretation.period &&
    !interpretation.date
  );
}

/** Preenche a opção achada (a intenção vira choose); sem posição, devolve o mesmo objeto */
export function applyPick(interpretation: Interpretation, pick: number | null): Interpretation {
  return pick ? { ...interpretation, intent: "choose" as const, option: pick } : interpretation;
}
