import assert from "node:assert/strict";
import { test } from "node:test";
import type { SchedulingSessionRow } from "../../db/schema.js";
import { setup, SESSION } from "../../test/router-harness.js";

/** Confirmação de cancelamento: o cliente foi perguntado se quer cancelar */
const CONFIRM_CANCEL = { ...SESSION, step: "confirm_cancel" } as SchedulingSessionRow;
/** Confirmação de remarcação: o horário novo já foi escolhido e o cliente diz sim ou não */
const CONFIRM_RESCHEDULE = { ...SESSION, step: "confirm_reschedule" } as SchedulingSessionRow;

test("recusa no cancelamento: a intenção que repete o assunto vira não, nunca cancelamento", async () => {
  const r = setup({ intent: "cancel", topicOnly: true, session: CONFIRM_CANCEL, agreement: "refuse", text: "não quero cancelar" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "no");
});

test("concordância 'pode sim camarada' na remarcação, rotulada reschedule, vai ao fluxo como sim", async () => {
  const r = setup({ intent: "reschedule", topicOnly: true, session: CONFIRM_RESCHEDULE, agreement: "agree", text: "pode sim camarada" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "yes");
  assert.equal(r.handled[0].interpretation.date, null);
});

test("falha da concordância no cancelamento: não é cancelamento, vira não entendi e o assistente pergunta de novo", async () => {
  const r = setup({ intent: "cancel", topicOnly: true, session: CONFIRM_CANCEL, agreement: null, text: "cancela" });
  assert.deepEqual(await r.reply(), { text: "handoff", ignorePause: true });
  assert.equal(r.handled[0].interpretation.intent, "unclear");
});

test("sem resposta clara no cancelamento ('neither') também vira não entendi", async () => {
  const r = setup({ intent: "cancel", topicOnly: true, session: CONFIRM_CANCEL, agreement: "neither", text: "e se for na quarta?" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "unclear");
});

test("falha da concordância na remarcação: a intenção do modelo fica, nunca vira sim", async () => {
  const r = setup({ intent: "reschedule", topicOnly: true, session: CONFIRM_RESCHEDULE, agreement: null, text: "hmm" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "reschedule");
});

test("intenção que não é só o assunto não passa pela concordância", async () => {
  const r = setup({ intent: "cancel", session: CONFIRM_CANCEL, agreement: "agree", text: "cancela" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "cancel");
});
