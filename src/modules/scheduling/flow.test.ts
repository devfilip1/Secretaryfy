import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { appointments, messages, type ConversationRow } from "../../db/schema.js";
import { createTestDb } from "../../test/db.js";
import { createFakeCalendar, type FakeCalendar } from "../../test/fake-calendar.js";
import type { ActiveConnection } from "../google/connection.js";
import { CalendarUnavailable } from "../google/gateway.js";
import type { InboxEvent } from "../inbox/events.js";
import { createInboxRepository, type InboxRepository } from "../inbox/repository.js";
import { createInboxService, type InboxService } from "../inbox/service.js";
import { createSchedulingFlow, type SchedulingFlow } from "./flow.js";
import type { Interpretation } from "./interpret.js";
import { DEFAULT_RULES, type Rules } from "./rules.js";
import { createSchedulingStore, SESSION_TTL_MS, type SchedulingStore } from "./sessions.js";

const tz = "America/Bahia";
// Terça, 20/10/2026, 15:00 em Salvador
const NOW = new Date("2026-10-20T18:00:00Z");
const at = (local: string) => new Date(`${local}-03:00`);

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let repo: InboxRepository;
let inbox: InboxService;
let store: SchedulingStore;
let fake: FakeCalendar;
let flow: SchedulingFlow;
let events: InboxEvent[];
let conn: ActiveConnection | null;
let rules: Rules;
let now: Date;

before(async () => {
  testDb = await createTestDb();
  repo = createInboxRepository(testDb.db as never);
  store = createSchedulingStore(testDb.db as never);
});
after(() => testDb.close());

beforeEach(async () => {
  for (const table of ["scheduling_sessions", "appointments", "messages", "conversations"]) {
    await testDb.db.execute(sql.raw(`delete from ${table}`));
  }
  events = [];
  now = NOW;
  rules = { ...DEFAULT_RULES };
  conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" };
  inbox = createInboxService({ repo, publish: (e) => events.push(e), now: () => now.getTime() });
  fake = createFakeCalendar();
  flow = createSchedulingFlow({
    calendar: fake.gateway,
    connection: { getForUse: async () => conn },
    rules: { get: async () => rules },
    store,
    inbox,
    now: () => now,
  });
});

async function conversation(phone = "5571999999999", name: string | null = "Maria"): Promise<ConversationRow> {
  return repo.upsertConversation({ phone, name, at: now, preview: "Oi" });
}

const I = (intent: Interpretation["intent"], extra: Partial<Interpretation> = {}): Interpretation => ({
  intent,
  option: null,
  date: null,
  name: null,
  source: "rule",
  ...extra,
});

/** Uma mensagem do cliente já interpretada, com a sessão atual da conversa. */
async function say(conv: ConversationRow, interpretation: Interpretation) {
  const fresh = (await repo.findConversation(conv.id))!;
  return flow.handle({ conversation: fresh, interpretation, session: await store.getSession(conv.id, now) });
}

const sessionOf = (conv: ConversationRow) => store.getSession(conv.id, now);
const systemTexts = async (conv: ConversationRow) =>
  (await testDb.db.select().from(messages)).filter((m) => m.conversationId === conv.id && m.origin === "system").map((m) => m.text);
const allAppointments = () => testDb.db.select().from(appointments);

/** Marca pela conversa: dia `day` da lista, horário `slot` do dia, e "yes". */
async function book(conv: ConversationRow, day = 2, slot = 2) {
  await say(conv, I("book"));
  await say(conv, I("choose", { option: day }));
  await say(conv, I("choose", { option: slot }));
  return say(conv, I("yes"));
}

// --- US2: consultar ---

test("disponibilidade: até 6 dias numerados com vaga, e a sessão fica em choose_day", async () => {
  const conv = await conversation();
  const { reply } = await say(conv, I("availability"));
  assert.equal(
    reply,
    "Sure! These days have openings:\n1. Tue, Oct 20\n2. Wed, Oct 21\n3. Thu, Oct 22\n4. Fri, Oct 23\n5. Mon, Oct 26\n6. Tue, Oct 27\nReply with the number of the day, or tell me another date.",
  );
  const s = await sessionOf(conv);
  assert.equal(s?.step, "choose_day");
  assert.equal(s?.options.length, 6);
});

test("escolher o dia mostra os horários livres; more mostra o resto", async () => {
  fake.block(at("2026-10-21T10:00"), at("2026-10-21T12:00"));
  const conv = await conversation();
  await say(conv, I("availability"));
  const { reply } = await say(conv, I("choose", { option: 2 }));
  assert.match(reply, /^Available times on Wed, Oct 21:\n1\. 9:00 AM\n2\. 12:00 PM\n3\. 1:00 PM\n4\. 2:00 PM\n5\. 3:00 PM\n6\. 4:00 PM\n/);
  assert.match(reply, /"more"/);
  assert.equal((await sessionOf(conv))?.step, "choose_slot");

  const more = await say(conv, I("more"));
  assert.match(more.reply, /^Available times on Wed, Oct 21:\n1\. 5:00 PM\n/);
});

test("dia sem atendimento: day_full com os dias mais próximos", async () => {
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { date: "2026-10-25" }));
  assert.match(reply, /^Sorry, there are no openings on Sun, Oct 25\. The closest days with openings are:\n1\. Wed, Oct 21/);
  assert.match(reply, /Mon, Oct 26/);
  assert.equal((await sessionOf(conv))?.step, "choose_day");
});

test("data além do limite: too_far com os primeiros dias", async () => {
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { date: "2027-01-10", tooFar: true }));
  assert.match(reply, /^I can only book up to 30 days ahead, until Thu, Nov 19\./);
});

test("agenda desconectada ou fora do ar: calendar_unavailable, sem quebrar", async () => {
  const conv = await conversation();
  conn = null;
  assert.match((await say(conv, I("availability"))).reply, /can't book appointments right now/);
  conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "needs_reauth" };
  assert.match((await say(conv, I("book"))).reply, /can't book appointments right now/);
  conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" };
  fake.failNext(new CalendarUnavailable("fora"));
  assert.match((await say(conv, I("availability"))).reply, /can't book appointments right now/);
});

test("sessão vencida é descartada", async () => {
  const conv = await conversation();
  await say(conv, I("availability"));
  assert.ok(await store.getSession(conv.id, now));
  assert.equal(await store.getSession(conv.id, new Date(now.getTime() + SESSION_TTL_MS + 1)), null);
  assert.equal(await store.getSession(conv.id, now), null);
});

// --- US1: marcar ---

test("marcar: confirmação com dia, hora, duração e nome; yes cria o evento e o agendamento", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  const confirm = await say(conv, I("choose", { option: 2 }));
  assert.equal(
    confirm.reply,
    "Please confirm your appointment:\n📅 Wed, Oct 21 at 10:00 AM (60 min)\n👤 Maria\nReply YES to confirm or NO to choose another time.",
  );

  const done = await say(conv, I("yes"));
  assert.equal(done.reply, "You're booked! 📅 Wed, Oct 21 at 10:00 AM. See you at DentalSafe.");
  assert.equal(fake.calls.createEvent, 1);
  const [event] = [...fake.events.values()];
  assert.equal(event.summary, "Avaliação — Maria");
  assert.equal(event.description, "WhatsApp: +5571999999999\nMarcado pelo Secretaryfy.");
  assert.equal(event.end.getTime() - event.start.getTime(), 60 * 60_000);
  const [appt] = await allAppointments();
  assert.equal(appt.status, "booked");
  assert.equal(appt.startsAt.toISOString(), at("2026-10-21T10:00").toISOString());
  assert.equal(event.properties.secretaryfy_appointment, appt.id);
  assert.equal(await sessionOf(conv), null);
  // US4: registro no histórico
  assert.deepEqual(await systemTexts(conv), ["📅 Agendado pelo assistente: qua, 21/10 às 10:00 (60 min)"]);
});

test("sem nome no WhatsApp, pergunta o nome antes de confirmar", async () => {
  const conv = await conversation("5571888888888", null);
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  assert.equal((await say(conv, I("choose", { option: 1 }))).reply, "What name should I put on the appointment?");
  const confirm = await say(conv, I("give_name", { name: "João" }));
  assert.match(confirm.reply, /👤 João/);
});

test("no na confirmação não cria nada e volta para os horários do dia", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("choose", { option: 2 }));
  const { reply } = await say(conv, I("no"));
  assert.match(reply, /^Available times on Wed, Oct 21/);
  assert.equal(fake.calls.createEvent, 0);
  assert.equal((await sessionOf(conv))?.step, "choose_slot");
});

test("horário ocupado entre a oferta e o yes: slot_taken, sem evento (FR-015)", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("choose", { option: 2 }));
  fake.block(at("2026-10-21T10:00"), at("2026-10-21T11:00"));
  const { reply } = await say(conv, I("yes"));
  assert.match(reply, /^Sorry, that time was just taken\. The closest available times on Wed, Oct 21 are:\n1\. 9:00 AM\n2\. 11:00 AM/);
  assert.equal(fake.calls.createEvent, 0);
  assert.equal((await allAppointments()).length, 0);
});

test("dois clientes confirmando o mesmo horário ao mesmo tempo: só um fica com ele (SC-003)", async () => {
  const a = await conversation("5571111111111", "Ana");
  const b = await conversation("5571222222222", "Bia");
  for (const c of [a, b]) {
    await say(c, I("book"));
    await say(c, I("choose", { option: 2 }));
    await say(c, I("choose", { option: 2 }));
  }
  const results = await Promise.all([say(a, I("yes")), say(b, I("yes"))]);
  assert.equal(results.filter((r) => r.reply.startsWith("You're booked!")).length, 1);
  assert.equal(results.filter((r) => r.reply.startsWith("Sorry, that time was just taken")).length, 1);
  assert.equal(fake.events.size, 1);
  assert.equal((await allAppointments()).length, 1);
});

test("falha ao criar o evento: calendar_unavailable e nada marcado (FR-024)", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("choose", { option: 2 }));
  // getEvent não é chamado (sem agendamento), busy passa, createEvent falha
  const original = fake.gateway.createEvent;
  fake.gateway.createEvent = async () => {
    throw new CalendarUnavailable("fora");
  };
  const { reply } = await say(conv, I("yes"));
  fake.gateway.createEvent = original;
  assert.match(reply, /can't book appointments right now/);
  assert.equal((await allAppointments()).length, 0);
});

test("um horário futuro por número; evento apagado no Google libera para marcar de novo (FR-019, FR-018a)", async () => {
  const conv = await conversation();
  await book(conv);
  const again = await say(conv, I("book"));
  assert.equal(again.reply, "You already have an appointment on Wed, Oct 21 at 10:00 AM. Would you like to reschedule it? (YES/NO)");
  assert.equal((await sessionOf(conv))?.step, "offer_reschedule");

  fake.events.clear();
  const fresh = await say(conv, I("book"));
  assert.match(fresh.reply, /^Sure! These days have openings/);
  const [appt] = await allAppointments();
  assert.equal(appt.status, "cancelled");
  assert.equal(appt.cancelledBy, "calendar");
  assert.ok((await systemTexts(conv)).includes("📅 Cancelado na agenda: qua, 21/10 às 10:00"));
});

test("duas respostas não entendidas seguidas: handoff, pausa e destaque (FR-024a)", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  const first = await say(conv, I("unclear"));
  assert.match(first.reply, /^Sorry, I didn't get that\. These days have openings:\n1\. Tue, Oct 20/);
  assert.equal((await sessionOf(conv))?.misunderstoodCount, 1);

  // Uma resposta entendida no meio zera o contador
  await say(conv, I("choose", { option: 2 }));
  assert.equal((await sessionOf(conv))?.misunderstoodCount, 0);
  await say(conv, I("unclear"));
  const second = await say(conv, I("unclear"));
  assert.equal(second.handoff, true);
  assert.match(second.reply, /Someone from our team will continue with you/);

  const after = (await repo.findConversation(conv.id))!;
  assert.equal(after.assistantPaused, true);
  assert.equal(after.needsAttention, true);
  assert.equal(await sessionOf(conv), null);
  assert.ok((await systemTexts(conv)).includes("⚠️ O assistente não entendeu o cliente e foi pausado nesta conversa"));
});

test("yes fora de uma pergunta de sim ou não conta como não entendido", async () => {
  const conv = await conversation();
  await say(conv, I("availability"));
  assert.match((await say(conv, I("yes"))).reply, /^Sorry, I didn't get that/);
});

// --- US5: consultar, cancelar e remarcar ---

test("my_appointment mostra o horário atual, inclusive se foi movido no Google", async () => {
  const conv = await conversation();
  assert.equal((await say(conv, I("my_appointment"))).reply, "I couldn't find an appointment for this number.");
  await book(conv);
  const [event] = [...fake.events.values()];
  event.start = at("2026-10-22T14:00");
  event.end = at("2026-10-22T15:00");
  assert.equal((await say(conv, I("my_appointment"))).reply, "Your appointment is on Thu, Oct 22 at 2:00 PM.");
  const [appt] = await allAppointments();
  assert.equal(appt.startsAt.toISOString(), at("2026-10-22T14:00").toISOString());
});

test("cancelar: confirmação, evento apagado, cancelado pelo cliente e registro", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  assert.equal((await say(conv, I("cancel"))).reply, "Cancel your appointment on Wed, Oct 21 at 10:00 AM? (YES/NO)");
  assert.equal((await say(conv, I("yes"))).reply, "Your appointment on Wed, Oct 21 at 10:00 AM was cancelled.");
  assert.equal(fake.events.size, 0);
  const [appt] = await allAppointments();
  assert.equal(appt.status, "cancelled");
  assert.equal(appt.cancelledBy, "customer");
  assert.ok((await systemTexts(conv)).includes("📅 Cancelado pelo cliente: qua, 21/10 às 10:00"));
});

test("no na confirmação do cancelamento mantém o horário", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  await say(conv, I("cancel"));
  assert.match((await say(conv, I("no"))).reply, /stays as it is/);
  assert.equal(fake.events.size, 1);
});

test("remarcar: escolhe dia e horário, confirma e o evento é movido", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  assert.match((await say(conv, I("reschedule"))).reply, /^Sure! These days have openings/);
  await say(conv, I("choose", { option: 4 }));
  const confirm = await say(conv, I("choose", { option: 6 }));
  assert.equal(confirm.reply, "Move your appointment from Wed, Oct 21 at 10:00 AM to Fri, Oct 23 at 2:00 PM? (YES/NO)");
  assert.equal((await say(conv, I("yes"))).reply, "Done! Your appointment is now on Fri, Oct 23 at 2:00 PM.");

  assert.equal(fake.calls.moveEvent, 1);
  const [event] = [...fake.events.values()];
  assert.equal(event.start.toISOString(), at("2026-10-23T14:00").toISOString());
  const [appt] = await allAppointments();
  assert.equal(appt.startsAt.toISOString(), at("2026-10-23T14:00").toISOString());
  assert.ok((await systemTexts(conv)).includes("📅 Remarcado pelo assistente: qua, 21/10 10:00 → sex, 23/10 14:00"));
});

test("yes na oferta de remarcar entra no fluxo de remarcação", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  await say(conv, I("book"));
  assert.match((await say(conv, I("yes"))).reply, /^Sure! These days have openings/);
  const s = await sessionOf(conv);
  assert.equal(s?.flow, "reschedule");
  assert.ok(s?.appointmentId);
});

test("dentro do prazo de cancelamento: too_late_to_change sem mexer na agenda (FR-027)", async () => {
  rules = { ...DEFAULT_RULES, minNoticeMinutes: 0 };
  const conv = await conversation();
  // Hoje às 16:00, daqui a 1 h, com prazo de 24 h
  await book(conv, 1, 2);
  const [appt] = await allAppointments();
  assert.equal(appt.startsAt.toISOString(), at("2026-10-20T16:00").toISOString());
  const { reply } = await say(conv, I("cancel"));
  assert.equal(reply, "Your appointment is in less than 24 hours, so I can't change it here. Please contact the clinic directly.");
  assert.match((await say(conv, I("reschedule"))).reply, /less than 24 hours/);
  assert.equal(fake.calls.deleteEvent, 0);
  assert.equal(fake.calls.moveEvent, 0);
});

test("evento apagado no Google antes do yes do cancelamento: no_appointment e registro", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  await say(conv, I("cancel"));
  fake.events.clear();
  assert.equal((await say(conv, I("yes"))).reply, "I couldn't find an appointment for this number.");
  assert.ok((await systemTexts(conv)).includes("📅 Cancelado na agenda: qua, 21/10 às 10:00"));
});

test("stop encerra o fluxo", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  assert.equal((await say(conv, I("stop"))).reply, "No problem. Let me know if you'd like to book later.");
  assert.equal(await sessionOf(conv), null);
});
