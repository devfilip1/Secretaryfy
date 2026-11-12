import assert from "node:assert/strict";
import { test } from "node:test";
import type { SchedulingSessionRow } from "../../db/schema.js";
import { setup } from "../../test/router-harness.js";

/** Tela de horários de quinta, 19/11/2026 (o assistente já mostrou os horários) */
const ON_SLOTS = {
  conversationId: "c1",
  flow: "book",
  step: "choose_slot",
  options: [
    { n: 1, kind: "slot", start: "2026-11-19T12:00:00.000Z" },
    { n: 2, kind: "slot", start: "2026-11-19T13:00:00.000Z" },
  ],
  misunderstoodCount: 0,
} as unknown as SchedulingSessionRow;

test("na tela de horários, 'dia 25' vai ao fluxo com a data citada, mesmo com a intenção de escolha", async () => {
  const r = setup({ intent: "choose", date: "2026-11-25", session: ON_SLOTS, when: { time: null, period: null, namesDay: true } });
  await r.reply();
  assert.equal(r.handled[0].interpretation.date, "2026-11-25");
  assert.equal(r.handled[0].interpretation.intent, "choose");
});

test("na tela de horários, 'não é o dia 19, dia 25' com 'outro dia' chega ao fluxo com o dia 25", async () => {
  const r = setup({ intent: "other_day", date: "2026-11-25", session: ON_SLOTS, when: { time: null, period: null, namesDay: true } });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "other_day");
  assert.equal(r.handled[0].interpretation.date, "2026-11-25");
});

test("'mais pela tardezinha': a parte do dia da chamada focada vira escolha de parte do dia", async () => {
  const r = setup({ intent: "more", session: ON_SLOTS, when: { time: null, period: "afternoon", namesDay: false } });
  await r.reply();
  const i = r.handled[0].interpretation;
  assert.equal(i.intent, "choose");
  assert.equal(i.period, "afternoon");
  assert.equal(i.option, null);
  assert.equal(i.time ?? null, null);
});

test("'ou noite': a parte da noite chega ao fluxo sem horário inventado", async () => {
  const r = setup({ intent: "more", session: ON_SLOTS, time: "09:00", when: { time: null, period: "evening", namesDay: false } });
  await r.reply();
  const i = r.handled[0].interpretation;
  assert.equal(i.period, "evening");
  assert.equal(i.time ?? null, null);
});

test("uma resposta igual à que o assistente já mandou ganha a abertura, e a lista não sai pura", async () => {
  const r = setup({
    intent: "choose",
    date: "2026-11-25",
    session: ON_SLOTS,
    when: { time: null, period: null, namesDay: true },
    flowReply: "Lista igual",
    assistantSaid: "Lista igual",
  });
  const reply = await r.reply();
  assert.ok(reply);
  assert.notEqual(reply.text, "Lista igual");
  assert.match(reply.text, /\n\nLista igual$/);
});
