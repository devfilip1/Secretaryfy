import assert from "node:assert/strict";
import { test } from "node:test";
import type { SchedulingStep } from "../../../db/schema.js";
import type { Intent, Interpretation, When } from "../interpret.js";
import { applyAgreement, applyPick, applySense, applyWhen, needsPick, wantsSense, wantsWhen } from "./resolve.js";

const base = (over: Partial<Interpretation> = {}): Interpretation => ({ intent: "book", option: null, date: null, name: null, source: "model", ...over });
const when = (over: Partial<When> = {}): When => ({ time: null, period: null, namesDay: null, ...over });

test("com uma janela de horários, a chamada focada não roda e o horário dela não muda a interpretação", () => {
  const windowed = base({ intent: "availability", timeWindow: { notAfter: "12:00" } });
  assert.equal(wantsWhen(windowed, "choose_slot"), false);
  assert.equal(applyWhen(windowed, when({ time: "12:00", namesDay: true }), "choose_slot"), windowed);
  assert.equal(applyWhen(windowed, when({ period: "morning", namesDay: false }), "choose_slot"), windowed);
});

test("wantsWhen: book, availability e reschedule pedem a chamada focada", () => {
  const cases: [Intent, SchedulingStep | null, boolean][] = [
    ["book", null, true],
    ["availability", null, true],
    ["reschedule", null, true],
    ["cancel", null, false],
  ];
  for (const [intent, step, expected] of cases) assert.equal(wantsWhen(base({ intent }), step), expected, `${intent} ${step}`);
});

test("wantsWhen: choose pede a chamada sem opção ou na etapa choose_slot", () => {
  const cases: [number | null, SchedulingStep | null, boolean][] = [
    [null, "choose_day", true],
    [null, null, true],
    [2, "choose_slot", true],
    [2, "choose_day", false],
  ];
  for (const [option, step, expected] of cases) assert.equal(wantsWhen(base({ intent: "choose", option }), step), expected, `option ${option} ${step}`);
});

test("wantsWhen: etapa choose_slot pede a chamada para qualquer intenção", () => {
  const intents: Intent[] = ["more", "unclear", "question", "stop", "yes"];
  for (const intent of intents) assert.equal(wantsWhen(base({ intent }), "choose_slot"), true, intent);
});

test("wantsWhen: outras intenções fora de choose_slot não pedem a chamada", () => {
  const intents: Intent[] = ["more", "unclear", "question", "stop", "yes", "no", "other_day", "give_name"];
  for (const intent of intents) assert.equal(wantsWhen(base({ intent }), "choose_day"), false, intent);
  assert.equal(wantsWhen(base({ intent: "question" }), undefined), false);
});

test("applyWhen: período vence o horário inventado e fica no lugar dele", () => {
  const result = applyWhen(base({ time: "14:00" }), when({ period: "morning", time: "09:00", namesDay: true }), null);
  assert.equal(result.period, "morning");
  assert.equal(result.time, null);
});

test("applyWhen: chamada focada que rodou sem horário ignora o horário do modelo", () => {
  const interpretation = base({ time: "09:00" });
  const result = applyWhen(interpretation, when({ namesDay: true, time: null }), null);
  assert.equal(result.time, null);
  assert.notEqual(result, interpretation);
});

test("applyWhen: chamada focada que rodou com horário usa o horário dela", () => {
  const result = applyWhen(base({ time: "09:00" }), when({ namesDay: true, time: "15:00" }), null);
  assert.equal(result.time, "15:00");
});

test("applyWhen: chamada sem rodar (namesDay ausente ou nulo) mantém o horário do modelo", () => {
  const interpretation = base({ time: "09:00" });
  assert.equal(applyWhen(interpretation, { time: null, period: null }, null), interpretation);
  assert.equal(applyWhen(interpretation, when({ namesDay: null, time: null }), null), interpretation);
  assert.equal(applyWhen(interpretation, null, null), interpretation);
});

test("applyWhen: namesDay false tira a data e o tooFar junto", () => {
  const result = applyWhen(base({ date: "2026-10-21", tooFar: true }), when({ namesDay: false }), null);
  assert.equal(result.date, null);
  assert.equal(result.tooFar, undefined);
});

test("applyWhen: namesDay true ou nulo mantém a data", () => {
  const interpretation = base({ date: "2026-10-21" });
  assert.equal(applyWhen(interpretation, when({ namesDay: true }), null).date, "2026-10-21");
  assert.equal(applyWhen(interpretation, when({ namesDay: null }), null), interpretation);
});

test("applyWhen: com horários na tela, horário ou período vira escolha nas intenções de escolha", () => {
  const intents: Intent[] = ["more", "unclear", "other_day", "availability"];
  for (const intent of intents) {
    const byTime = applyWhen(base({ intent }), when({ namesDay: true, time: "14:00" }), "choose_slot");
    assert.equal(byTime.intent, "choose", `${intent} com horário`);
    assert.equal(byTime.option, null);
    const byPeriod = applyWhen(base({ intent }), when({ namesDay: true, period: "evening" }), "choose_slot");
    assert.equal(byPeriod.intent, "choose", `${intent} com período`);
    assert.equal(byPeriod.option, null);
  }
});

test("applyWhen: fora de choose_slot, ou com intenção fora da lista, a intenção fica", () => {
  const byOtherStep = applyWhen(base({ intent: "more" }), when({ namesDay: true, time: "14:00" }), "choose_day");
  assert.equal(byOtherStep.intent, "more");
  assert.equal(byOtherStep.time, "14:00");
  const byOtherIntent = applyWhen(base({ intent: "book" }), when({ namesDay: true, time: "14:00" }), "choose_slot");
  assert.equal(byOtherIntent.intent, "book");
  assert.equal(byOtherIntent.time, "14:00");
});

test("applyWhen: nada muda devolve o mesmo objeto", () => {
  const interpretation = base({ time: "10:00" });
  assert.equal(applyWhen(interpretation, when({ namesDay: true, time: "10:00" }), "choose_slot"), interpretation);
  const withDate = base({ date: "2026-10-21" });
  assert.equal(applyWhen(withDate, when({ namesDay: false }), null).date, null);
  assert.equal(applyWhen(base(), null, "choose_slot").intent, "book");
});

test("needsPick: com opções na tela, intenção de escolha ou não entendida (mesmo com opção do modelo), e sem horário, período ou data", () => {
  const cases: [Interpretation, number, boolean][] = [
    [base({ intent: "choose" }), 3, true],
    [base({ intent: "unclear" }), 3, true],
    [base({ intent: "choose" }), 0, false],
    [base({ intent: "choose", option: 2 }), 3, true],
    [base({ intent: "choose", time: "10:00" }), 3, false],
    [base({ intent: "choose", period: "morning" }), 3, false],
    [base({ intent: "unclear", date: "2026-10-21" }), 3, false],
    [base({ intent: "book" }), 3, false],
    [base({ intent: "more" }), 3, false],
  ];
  for (const [interpretation, count, expected] of cases) assert.equal(needsPick(interpretation, count), expected, `${interpretation.intent} ${count}`);
});

test("applyPick: a posição achada vira escolha", () => {
  const result = applyPick(base({ intent: "unclear" }), 2);
  assert.equal(result.intent, "choose");
  assert.equal(result.option, 2);
});

test("applyPick: sem posição devolve o mesmo objeto", () => {
  const interpretation = base({ intent: "unclear" });
  assert.equal(applyPick(interpretation, null), interpretation);
});

test("applyPick: uma opção que só o modelo deu, sem citação no texto, vira não entendi", () => {
  const result = applyPick(base({ intent: "choose", option: 3 }), null);
  assert.equal(result.intent, "unclear");
  assert.equal(result.option, null);
});

test("applyPick: a posição citada vence a opção do modelo", () => {
  assert.equal(applyPick(base({ intent: "choose", option: 3 }), 1).option, 1);
});

test("wantsSense: só rude, manipulation e off_topic pedem a chamada de sentido", () => {
  const intents: Intent[] = ["rude", "manipulation", "off_topic"];
  for (const intent of intents) assert.equal(wantsSense(base({ intent })), true, intent);
  const others: Intent[] = ["book", "unclear", "choose", "question", "cancel", "stop"];
  for (const intent of others) assert.equal(wantsSense(base({ intent })), false, intent);
});

test("applySense: sem sentido vira não entendi e os outros campos ficam", () => {
  const result = applySense(base({ intent: "rude", date: "2026-10-21", name: "Ana" }), true);
  assert.equal(result.intent, "unclear");
  assert.equal(result.date, "2026-10-21");
  assert.equal(result.name, "Ana");
});

test("applySense: com sentido, nulo ou intenção fora do grupo, devolve o mesmo objeto", () => {
  const rude = base({ intent: "rude" });
  assert.equal(applySense(rude, false), rude);
  assert.equal(applySense(rude, null), rude);
  const book = base({ intent: "book" });
  assert.equal(applySense(book, true), book);
});

test("applyAgreement: sem topicOnly, devolve o mesmo objeto", () => {
  const cancel = base({ intent: "cancel" });
  assert.equal(applyAgreement(cancel, "confirm_cancel", "agree"), cancel);
  assert.equal(applyAgreement(cancel, "confirm_cancel", "refuse"), cancel);
});

test("applyAgreement: concordância vira sim e limpa o que o modelo inventou", () => {
  const result = applyAgreement(base({ intent: "reschedule", topicOnly: true, date: "2026-10-21", time: "09:00", option: 2 }), "confirm_reschedule", "agree");
  assert.deepEqual([result.intent, result.date, result.time, result.option], ["yes", null, null, null]);
});

test("applyAgreement: recusa vira não, em qualquer confirmação", () => {
  const steps: [SchedulingStep, Intent][] = [
    ["confirm_cancel", "cancel"],
    ["confirm_booking", "book"],
    ["confirm_reschedule", "reschedule"],
    ["offer_reschedule", "reschedule"],
  ];
  for (const [step, intent] of steps) assert.equal(applyAgreement(base({ intent, topicOnly: true }), step, "refuse").intent, "no", step);
});

test("applyAgreement: sem resposta clara no cancelamento vira não entendi, nunca sim", () => {
  for (const agreement of ["neither", null] as const) {
    const result = applyAgreement(base({ intent: "cancel", topicOnly: true, date: "2026-10-21" }), "confirm_cancel", agreement);
    assert.equal(result.intent, "unclear", String(agreement));
    assert.equal(result.date, null);
  }
});

test("applyAgreement: sem resposta clara no agendamento ou na remarcação, a intenção do modelo fica, nunca sim", () => {
  const steps: [SchedulingStep, Intent][] = [
    ["confirm_booking", "book"],
    ["confirm_reschedule", "reschedule"],
    ["offer_reschedule", "reschedule"],
  ];
  for (const [step, intent] of steps) {
    for (const agreement of ["neither", null] as const) {
      assert.equal(applyAgreement(base({ intent, topicOnly: true }), step, agreement).intent, intent, `${step} ${agreement}`);
    }
  }
});
