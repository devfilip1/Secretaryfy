import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES, type Rules } from "../rules.js";
import { useFlowHarness } from "../../../test/flow-harness.js";

const h = useFlowHarness();
const { say, conversation, I, sessionOf } = h;

// Terça, 20/10/2026: o fim de semana da janela é sábado 24 e domingo 25
const SATURDAY = "2026-10-24";
const SUNDAY = "2026-10-25";
const hours = { start: "09:00", end: "18:00" };
const openOn = (...days: number[]): Rules["weeklyHours"] => Object.fromEntries(days.map((d) => [String(d), hours]));

test("fim de semana com sábado e domingo abertos: os dois dias são oferecidos como opções", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6, 7) };
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { weekend: true }));
  assert.equal(reply, "Sure! These days have openings:\n• Saturday, October 24\n• Sunday, October 25\nWhich one works best for you? Or tell me another date.");
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_day");
  assert.deepEqual(s?.options.map((o) => (o.kind === "day" ? o.date : null)), [SATURDAY, SUNDAY]);
});

test("fim de semana com domingo fechado: diz que não atende no domingo e oferece o sábado", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6) };
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { weekend: true }));
  assert.equal(
    reply,
    "We're closed on Sundays. The closest days with openings are:\n• Saturday, October 24\nWhich one works best for you? Or tell me another date.",
  );
  const s = await sessionOf(conv);
  assert.deepEqual(s?.options.map((o) => (o.kind === "day" ? o.date : null)), [SATURDAY]);
});

test("fim de semana com os dois dias fechados: diz que não atende e oferece os dias mais próximos, sem fim de semana", async () => {
  // DEFAULT_RULES: segunda a sexta
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { weekend: true }));
  assert.match(reply, /^We're closed on Saturdays and Sundays\. The closest days with openings are:\n• /);
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_day");
  for (const o of s?.options ?? []) {
    assert.ok(o.kind === "day");
    assert.ok(![6, 7].includes(new Date(`${o.date}T12:00:00-03:00`).getUTCDay() || 7), o.date);
  }
});

test("escolher o fim de semana na lista com os dois dias: a lista mostra os dois de novo, sem escolher um só", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6, 7) };
  const conv = await conversation();
  await say(conv, I("availability", { weekend: true }));
  const { reply } = await say(conv, I("choose", { weekend: true }));
  assert.match(reply, /• Saturday, October 24\n• Sunday, October 25\n/);
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_day");
  assert.equal(s?.options.length, 2);
});

test("escolher o fim de semana na lista com só o sábado (domingo fechado): diz que o domingo está fechado", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6) };
  const conv = await conversation();
  await say(conv, I("availability", { weekend: true }));
  const { reply } = await say(conv, I("choose", { weekend: true }));
  assert.match(reply, /^We're closed on Sundays\. The closest days with openings are:\n• Saturday, October 24\n/);
});

test("marcar no fim de semana: oferece sábado e domingo, como a consulta por dias", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6, 7) };
  const conv = await conversation();
  const { reply } = await say(conv, I("book", { weekend: true }));
  assert.match(reply, /^Sure! These days have openings:\n• Saturday, October 24\n• Sunday, October 25\n/);
});
