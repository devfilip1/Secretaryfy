/**
 * Intenções que o agendamento entende (contracts/interpreter.md) e os grupos nomeados de intenções.
 * Este arquivo não importa nada do projeto: interpret, router, flow e understanding/ importam daqui.
 * Os arrays dos grupos são privados: quem usa um grupo chama o predicado dele, nunca uma lista de strings.
 */
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
  "greeting",
  "who_are_you",
  "needs_staff",
  "manipulation",
  "rude",
  "question",
  "unclear",
  "off_topic",
] as const;

export type Intent = (typeof INTENTS)[number];

/** Pedem um dia ou um horário: a chamada focada de horário roda para elas, e um dia dado sem o cliente citar fica de fora */
const ASKS_FOR_WHEN_INTENTS: readonly Intent[] = ["book", "availability", "reschedule"];
/** Podem levar o horário ou o dia que o cliente citou na frase (validate, em interpret.ts) */
const CAN_CARRY_A_WHEN_INTENTS: readonly Intent[] = ["choose", "book", "availability", "reschedule"];
/** Só existem dentro de uma etapa (responder a uma lista oferecida); sem etapa, a mensagem só vira dar o nome, se o nome acabou de ser pedido */
const STEP_ONLY_INTENTS: readonly Intent[] = ["choose", "more", "other_day", "choose_service"];
/** Começam um fluxo de agendamento quando não há etapa em andamento (research.md R3) */
const STARTS_SCHEDULING_INTENTS: readonly Intent[] = ["book", "availability", "cancel", "reschedule", "my_appointment"];
/** Escolhem um dia da lista de dias na tela: o dia da semana citado vira a opção dele (validate, em interpret.ts) */
const PICKS_OFFERED_DAY_INTENTS: readonly Intent[] = ["choose", "other_day"];
/** Com os horários na tela, um horário ou uma parte do dia citados viram escolha dentro do dia (applyWhen, em resolve.ts) */
const CHOICE_LIKE_INTENTS: readonly Intent[] = ["more", "unclear", "other_day", "availability"];
/** Pedem um dia além do limite de dias à frente: o fluxo explica, em vez de contar como não entendi (flow.dispatch) */
const TOO_FAR_INTENTS: readonly Intent[] = ["availability", "choose", "book"];
/** Com os horários do dia na tela, "de tarde" (parte do dia sem horário) é a parte desse mesmo dia (flow.dispatch) */
const ASKS_PERIOD_OF_SCREEN_INTENTS: readonly Intent[] = ["choose", "availability"];
/** Podem ser só palavras sem sentido: a chamada de sentido (understanding/sense.ts) confere, e só rebaixa para não entendi (applySense, em resolve.ts) */
const MAY_BE_NOISE_INTENTS: readonly Intent[] = ["rude", "manipulation", "off_topic"];

/** Os grupos por nome, só para o teste de intents.test.ts fotografar os membros; o código usa os predicados */
export const INTENT_GROUPS = {
  ASKS_FOR_WHEN: ASKS_FOR_WHEN_INTENTS,
  CAN_CARRY_A_WHEN: CAN_CARRY_A_WHEN_INTENTS,
  STEP_ONLY: STEP_ONLY_INTENTS,
  STARTS_SCHEDULING: STARTS_SCHEDULING_INTENTS,
  PICKS_OFFERED_DAY: PICKS_OFFERED_DAY_INTENTS,
  CHOICE_LIKE: CHOICE_LIKE_INTENTS,
  TOO_FAR: TOO_FAR_INTENTS,
  ASKS_PERIOD_OF_SCREEN: ASKS_PERIOD_OF_SCREEN_INTENTS,
  MAY_BE_NOISE: MAY_BE_NOISE_INTENTS,
} as const;

/** Pede um dia ou um horário (ver ASKS_FOR_WHEN_INTENTS) */
export const asksForWhen = (intent: Intent): boolean => ASKS_FOR_WHEN_INTENTS.includes(intent);
/** Pode levar o horário ou o dia citados na frase */
export const canCarryAWhen = (intent: Intent): boolean => CAN_CARRY_A_WHEN_INTENTS.includes(intent);
/** Só existe dentro de uma etapa de lista */
export const isStepOnly = (intent: Intent): boolean => STEP_ONLY_INTENTS.includes(intent);
/** Começa um fluxo de agendamento sem etapa em andamento */
export const startsScheduling = (intent: Intent): boolean => STARTS_SCHEDULING_INTENTS.includes(intent);
/** Escolhe um dia da lista de dias na tela */
export const picksOfferedDay = (intent: Intent): boolean => PICKS_OFFERED_DAY_INTENTS.includes(intent);
/** Vira escolha quando há horário ou parte do dia com os horários na tela */
export const isChoiceLike = (intent: Intent): boolean => CHOICE_LIKE_INTENTS.includes(intent);
/** Pede um dia além do limite de dias à frente */
export const isTooFar = (intent: Intent): boolean => TOO_FAR_INTENTS.includes(intent);
/** Com os horários do dia na tela, pede a parte do dia desse mesmo dia */
export const asksPeriodOfScreen = (intent: Intent): boolean => ASKS_PERIOD_OF_SCREEN_INTENTS.includes(intent);
/** Pode ser só palavras sem sentido (ver MAY_BE_NOISE_INTENTS) */
export const mayBeNoise = (intent: Intent): boolean => MAY_BE_NOISE_INTENTS.includes(intent);
