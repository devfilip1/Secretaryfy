import assert from "node:assert/strict";
import { test } from "node:test";
import type { SchedulingSessionRow } from "../../db/schema.js";
import { setup } from "../../test/router-harness.js";

/** Tela de horários de quinta, 19/11/2026: 11h às 16h (Salvador, UTC-3), como na conversa real */
const ON_SLOTS = {
  conversationId: "c1",
  flow: "book",
  step: "choose_slot",
  options: [11, 12, 13, 14, 15, 16].map((h, k) => ({ n: k + 1, kind: "slot", start: `2026-11-19T${String(h + 3).padStart(2, "0")}:00:00.000Z` })),
  misunderstoodCount: 0,
} as unknown as SchedulingSessionRow;

test("'tem algo antes das 12?': a janela vai ao fluxo, e a hora que a chamada focada acha não vira escolha", async () => {
  const r = setup({ intent: "availability", window: { notAfter: "12:00" }, session: ON_SLOTS, when: { time: "12:00", period: null, namesDay: true } });
  await r.reply();
  const i = r.handled[0].interpretation;
  assert.equal(i.intent, "availability");
  assert.deepEqual(i.timeWindow, { notAfter: "12:00" });
  assert.equal(i.option, null);
  assert.equal(i.time ?? null, null);
  assert.equal(i.period ?? null, null);
  assert.equal(r.whenCalls.length, 0, "a chamada focada não roda com a janela");
});

test("'antes das 12, de manhã': a parte do dia que a chamada focada acha não vira escolha nem muda a janela", async () => {
  const r = setup({ intent: "availability", window: { notAfter: "12:00" }, session: ON_SLOTS, when: { time: null, period: "morning", namesDay: false } });
  await r.reply();
  const i = r.handled[0].interpretation;
  assert.equal(i.intent, "availability");
  assert.deepEqual(i.timeWindow, { notAfter: "12:00" });
  assert.equal(i.period ?? null, null);
  assert.equal(i.option, null);
});
