import assert from "node:assert/strict";
import { test } from "node:test";
import { at, useFlowHarness } from "../../../test/flow-harness.js";

const h = useFlowHarness();
const { say, conversation, I, sessionOf } = h;

// Quinta, 19/11/2026. Sem bloqueio, os horários cheios vão das 9h às 17h: a primeira página são 9h a 14h.

test("pedido 'de tarde' com horários da tarde livres: mostra os da tarde, não a página da manhã (bug: 'mais pela tardezinha')", async () => {
  h.now = at("2026-11-12T10:00");
  // Das 12h às 15h ocupado: na tela ficam 9h, 10h, 11h, 15h, 16h e 17h
  h.fake.block(at("2026-11-19T12:00"), at("2026-11-19T15:00"));
  const conv = await conversation();
  await say(conv, I("availability", { date: "2026-11-19" }));
  const { reply } = await say(conv, I("choose", { period: "afternoon" }));
  assert.match(reply, /^On Thursday, November 19 I have these times:\n• 3:00 PM\n• 4:00 PM\n• 5:00 PM\n/);
  assert.doesNotMatch(reply, /9:00 AM|10:00 AM|11:00 AM/);
  assert.equal((await sessionOf(conv))?.step, "choose_slot");
});

test("noite sem horário, com todos os horários do dia já na tela: não repete a lista; diz que não há mais no dia e oferece outros dias", async () => {
  h.now = at("2026-11-12T10:00");
  // Das 12h às 15h ocupado: o dia tem só 9h, 10h, 11h, 15h, 16h e 17h, e todos cabem na tela
  h.fake.block(at("2026-11-19T12:00"), at("2026-11-19T15:00"));
  const conv = await conversation();
  await say(conv, I("availability", { date: "2026-11-19" }));
  const { reply } = await say(conv, I("choose", { period: "evening" }));
  assert.doesNotMatch(reply, /9:00 AM/);
  assert.match(reply, /^There are no more openings that day/);
  assert.equal((await sessionOf(conv))?.step, "choose_day");
});

test("noite sem horário e o dia com mais horários antes: mostra os mais tarde do dia, com o aviso", async () => {
  h.now = at("2026-11-12T10:00");
  const conv = await conversation();
  // Dia inteiro livre: a tela tem 9h a 14h, e o dia ainda tem 15h, 16h e 17h
  await say(conv, I("availability", { date: "2026-11-19" }));
  const { reply } = await say(conv, I("choose", { period: "evening" }));
  assert.match(
    reply,
    /^I have nothing free in the evening on Thursday, November 19, but these are open:\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\n• 3:00 PM\n• 4:00 PM\n• 5:00 PM\n/,
  );
  assert.doesNotMatch(reply, /9:00 AM|10:00 AM|11:00 AM/);
  assert.match(reply, /I can show more times or another day if you like\.$/);
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_slot");
  assert.equal(s?.options.length, 6);
});

test("outro dia citado (dia 25) na tela de horários de 19: oferece os horários do dia 25, não a lista de dias", async () => {
  h.now = at("2026-11-12T10:00");
  const conv = await conversation();
  await say(conv, I("availability", { date: "2026-11-19" }));
  const { reply } = await say(conv, I("other_day", { date: "2026-11-25" }));
  assert.match(reply, /^On Wednesday, November 25 I have these times:\n• 9:00 AM/);
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_slot");
  assert.equal(s?.options.length, 6);
});

test("'mais' com um dia citado que não é o da tela vai para esse dia", async () => {
  h.now = at("2026-11-12T10:00");
  const conv = await conversation();
  await say(conv, I("availability"));
  const { reply } = await say(conv, I("more", { date: "2026-11-25" }));
  assert.match(reply, /^On Wednesday, November 25 I have these times:/);
});

test("'outro dia' com a data da própria tela não vira o horário dela: abre a lista de dias", async () => {
  h.now = at("2026-11-12T10:00");
  const conv = await conversation();
  await say(conv, I("availability", { date: "2026-11-19" }));
  await say(conv, I("other_day", { date: "2026-11-19" }));
  assert.equal((await sessionOf(conv))?.step, "choose_day");
});
