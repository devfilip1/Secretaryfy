import assert from "node:assert/strict";
import { test } from "node:test";
import { CalendarUnavailable } from "../../google/gateway.js";
import { SESSION_TTL_MS } from "../sessions.js";
import { at, tz, useFlowHarness } from "../../../test/flow-harness.js";

const h = useFlowHarness();
const { say, conversation, I, sessionOf } = h;

// --- US2: consultar ---

test("disponibilidade: até 6 dias em bullets com vaga, e a sessão fica em choose_day", async () => {
  const conv = await conversation();
  const { reply } = await say(conv, I("availability"));
  assert.equal(
    reply,
    "Sure! These days have openings:\n• Tuesday, October 20\n• Wednesday, October 21\n• Thursday, October 22\n• Friday, October 23\n• Monday, October 26\n• Tuesday, October 27\nWhich one works best for you? Or tell me another date.",
  );
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_day");
  assert.equal(s?.options.length, 6);
});

test("escolher o dia mostra os horários livres; more mostra o resto", async () => {
  h.fake.block(at("2026-10-21T10:00"), at("2026-10-21T12:00"));
  const conv = await conversation();
  await say(conv, I("availability"));
  const { reply } = await say(conv, I("choose", { option: 2 }));
  assert.match(reply, /^On Wednesday, October 21 I have these times:\n• 9:00 AM\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\n• 3:00 PM\n• 4:00 PM\nWhich one would you like\? I can show more times/);
  assert.equal((await sessionOf(conv))?.step, "choose_slot");

  const more = await say(conv, I("more"));
  assert.match(more.reply, /^On Wednesday, October 21 I have these times:\n• 5:00 PM\n/);
});

test("parte do dia pedida: só os horários da manhã (antes das 12h) ou só os da tarde", async () => {
  const conv = await conversation();
  const morning = await say(conv, I("availability", { date: "2026-10-21", period: "morning" }));
  assert.match(morning.reply, /^On Wednesday, October 21 I have these times:\n• 9:00 AM\n• 10:00 AM\n• 11:00 AM\nWhich one would you like\?/);
  const afternoon = await say(conv, I("availability", { date: "2026-10-21", period: "afternoon" }));
  assert.match(afternoon.reply, /^On Wednesday, October 21 I have these times:\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\n• 3:00 PM\n• 4:00 PM\n• 5:00 PM\n/);
});

test("parte do dia sem vaga, com horários no resto do dia: periodEmpty com esses horários, salvos na sessão", async () => {
  h.fake.block(at("2026-10-21T09:00"), at("2026-10-21T12:00"));
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { date: "2026-10-21", period: "morning" }));
  assert.match(reply, /^I have nothing free in the morning on Wednesday, October 21, but these are open:\n• 12:00 PM\n• 1:00 PM\n/);
  assert.match(reply, /Which one would you like\? I can also check another day if you like\.$/);
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_slot");
  const expected = [12, 13, 14, 15, 16, 17].map((h) => at(`2026-10-21T${String(h).padStart(2, "0")}:00`).toISOString());
  assert.deepEqual(
    s?.options.map((o) => (o.kind === "slot" ? o.start : null)),
    expected,
  );
});

test("horário citado junto com a parte do dia: vale o horário, como antes", async () => {
  const conv = await conversation();
  await say(conv, I("availability", { date: "2026-10-21", period: "morning", time: "14:00" }));
  const s = await sessionOf(conv);
  assert.equal(s?.step, "confirm_booking");
  assert.equal(s?.selectedStart?.getTime(), at("2026-10-21T14:00").getTime());
});

test("na tela de horários, 'de tarde' oferece a tarde desse mesmo dia", async () => {
  const conv = await conversation();
  await say(conv, I("availability", { date: "2026-10-21" }));
  const { reply } = await say(conv, I("choose", { period: "afternoon" }));
  assert.match(reply, /^On Wednesday, October 21 I have these times:\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\n• 3:00 PM\n• 4:00 PM\n• 5:00 PM\n/);
  assert.doesNotMatch(reply, /9:00 AM|11:00 AM/);
  assert.equal((await sessionOf(conv))?.step, "choose_slot");
});

test("dia fechado nas regras semanais: avisa que não atende e oferece os dias mais próximos", async () => {
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { date: "2026-10-25" }));
  assert.match(reply, /^We're closed on Saturdays and Sundays\. The closest days with openings are:\n• Wednesday, October 21/);
  assert.match(reply, /• Monday, October 26/);
  assert.equal((await sessionOf(conv))?.step, "choose_day");
});

test("dia que atende mas está lotado: day_full com os dias mais próximos", async () => {
  h.fake.block(at("2026-10-21T00:00"), at("2026-10-22T00:00"));
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { date: "2026-10-21" }));
  assert.match(reply, /^Sorry, there are no openings on Wednesday, October 21\. The closest days with openings are:/);
});

test("data além do limite: too_far com os primeiros dias", async () => {
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { date: "2027-01-10", tooFar: true }));
  assert.match(reply, /^I can only book up to 30 days ahead, until Thursday, November 19\./);
});

test("agenda desconectada ou fora do ar: calendar_unavailable, sem quebrar", async () => {
  const conv = await conversation();
  h.conn = null;
  assert.match((await say(conv, I("availability"))).reply, /can't book appointments right now/);
  h.conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "needs_reauth" };
  assert.match((await say(conv, I("book"))).reply, /can't book appointments right now/);
  h.conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" };
  h.fake.failNext(new CalendarUnavailable("fora"));
  assert.match((await say(conv, I("availability"))).reply, /can't book appointments right now/);
});

test("sessão vencida é descartada", async () => {
  const conv = await conversation();
  await say(conv, I("availability"));
  assert.ok(await h.store.getSession(conv.id, h.now));
  assert.equal(await h.store.getSession(conv.id, new Date(h.now.getTime() + SESSION_TTL_MS + 1)), null);
  assert.equal(await h.store.getSession(conv.id, h.now), null);
});
