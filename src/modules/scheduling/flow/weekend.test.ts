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

test("fim de semana com sábado e domingo abertos: diz que os dois são atendidos e lista as próximas datas", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6, 7) };
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { weekend: true }));
  assert.equal(
    reply,
    "We're open on Saturdays and Sundays. These are the next days with openings:\n• Saturday, October 24\n• Sunday, October 25\n• Saturday, October 31\n• Sunday, November 1\n• Saturday, November 7\n• Sunday, November 8\nWhich one works best for you?",
  );
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_day");
  assert.deepEqual(
    s?.options.map((o) => (o.kind === "day" ? o.date : null)),
    [SATURDAY, SUNDAY, "2026-10-31", "2026-11-01", "2026-11-07", "2026-11-08"],
  );
});

test("fim de semana com domingo fechado: diz que atende aos sábados, que o domingo está fechado, e oferece os próximos sábados", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6) };
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { weekend: true }));
  assert.equal(
    reply,
    "We're open on Saturdays. We're closed on Sundays. These are the next Saturdays with openings:\n• Saturday, October 24\n• Saturday, October 31\n• Saturday, November 7\n• Saturday, November 14\nWhich one works best for you?",
  );
  const s = await sessionOf(conv);
  assert.deepEqual(s?.options.map((o) => (o.kind === "day" ? o.date : null)), ["2026-10-24", "2026-10-31", "2026-11-07", "2026-11-14"]);
});

test("o cliente escolhe 'o primeiro' depois da lista do fim de semana: abre os horários do sábado", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6) };
  const conv = await conversation();
  await say(conv, I("availability", { weekend: true }));
  const { reply } = await say(conv, I("choose", { option: 1 }));
  assert.match(reply, /^On Saturday, October 24 I have these times:/);
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
  assert.match(reply, /^We're open on Saturdays and Sundays\. These are the next days with openings:\n• Saturday, October 24\n• Sunday, October 25\n/);
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_day");
  assert.equal(s?.options.length, 6);
});

test("escolher o fim de semana na lista com só o sábado (domingo fechado): diz que atende aos sábados e o domingo está fechado", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6) };
  const conv = await conversation();
  await say(conv, I("availability", { weekend: true }));
  const { reply } = await say(conv, I("choose", { weekend: true }));
  assert.match(reply, /^We're open on Saturdays\. We're closed on Sundays\. These are the next Saturdays with openings:\n• Saturday, October 24\n/);
});

test("marcar no fim de semana: oferece sábado e domingo, como a consulta por dias", async () => {
  h.rules = { ...DEFAULT_RULES, weeklyHours: openOn(1, 2, 3, 4, 5, 6, 7) };
  const conv = await conversation();
  const { reply } = await say(conv, I("book", { weekend: true }));
  assert.match(reply, /^We're open on Saturdays and Sundays\. These are the next days with openings:\n• Saturday, October 24\n• Sunday, October 25\n/);
});
