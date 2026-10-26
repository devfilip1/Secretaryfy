import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { messages, type AppointmentRow } from "../../db/schema.js";
import { createTestDb } from "../../test/db.js";
import { createFakeCalendar, type FakeCalendar } from "../../test/fake-calendar.js";
import type { BlockReason } from "../antiban/queue.js";
import type { ActiveConnection } from "../google/connection.js";
import { createInboxRepository, type InboxRepository } from "../inbox/repository.js";
import { createInboxService, type InboxService } from "../inbox/service.js";
import { createSchedulingStore, type SchedulingStore } from "../scheduling/sessions.js";
import { createReminderScheduler, type ReminderScheduler } from "./scheduler.js";

const tz = "America/Bahia";
// Terça, 20/10/2026, 15:00 em Salvador
const NOW = new Date("2026-10-20T18:00:00Z");
const at = (local: string) => new Date(`${local}-03:00`);
const PHONE = "5571999999999";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let repo: InboxRepository;
let store: SchedulingStore;
let inbox: InboxService;
let fake: FakeCalendar;
let conn: ActiveConnection | null;
let now: Date;
let blockReason: BlockReason | null;
let sendOutcome: "sent" | "failed" | "blocked";
let sent: { conversationId: string; text: string }[];
let scheduler: ReminderScheduler;

before(async () => {
  testDb = await createTestDb();
  repo = createInboxRepository(testDb.db as never);
  store = createSchedulingStore(testDb.db as never);
});
after(() => testDb.close());

beforeEach(async () => {
  await testDb.db.execute(sql`truncate table scheduling_sessions, appointments, customers, messages, conversations cascade`);
  now = NOW;
  conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" };
  fake = createFakeCalendar();
  blockReason = null;
  sendOutcome = "sent";
  sent = [];
  inbox = createInboxService({ repo, publish: () => {}, now: () => now.getTime() });
  scheduler = createReminderScheduler({
    store,
    calendar: fake.gateway,
    connection: { getForUse: async () => conn },
    gate: {
      assistantBlockReason: async () => blockReason,
      // Como o portão: o texto enviado vira mensagem do assistente na conversa
      sendAssistant: async ({ conversationId, text }) => {
        if (sendOutcome !== "sent") return sendOutcome;
        sent.push({ conversationId, text });
        const out = await inbox.startOutgoing({ conversationId, origin: "assistant", text });
        await inbox.finishOutgoing(out.id, { waId: `OUT${sent.length}` });
        return "sent";
      },
      pickVariant: async (_id, options) => options.find((o) => !sent.some((s) => s.text === o)) ?? null,
    },
    inboxRepo: repo,
    inbox,
    log: { info: () => {}, error: () => {} },
    now: () => now,
    leadMinutes: 1440,
    cutoffMinutes: 120,
    tickMs: 60_000,
  });
});

/** Conversa em que o cliente escreveu e o assistente já respondeu (a janela de 24 h está aberta). */
async function conversation(phone = PHONE, name: string | null = "Maria") {
  const { conversation } = await inbox.recordIncoming({
    kind: "message",
    id: `IN-${phone}`,
    phone,
    fromMe: false,
    type: "text",
    text: "Hi",
    sentAt: new Date(now.getTime() - 60_000),
  });
  const out = await inbox.startOutgoing({ conversationId: conversation.id, origin: "assistant", text: "Hello!" });
  await inbox.finishOutgoing(out.id, { waId: `OUT-${phone}` });
  if (name) await repo.setCustomerName(conversation.id, name);
  return conversation;
}

async function appointment(local = "2026-10-21T10:00", phone = PHONE): Promise<AppointmentRow> {
  const start = at(local);
  const end = new Date(start.getTime() + 3_600_000);
  const { eventId } = await fake.gateway.createEvent({ summary: "Maria — Dental Cleaning", description: "", start, end, timeZone: tz, properties: {} });
  return (await store.insertBooked({
    id: crypto.randomUUID(),
    conversationId: null,
    phone,
    origin: "assistant",
    googleEventId: eventId,
    calendarId: "primary",
    startsAt: start,
    endsAt: end,
    customerName: "Maria",
    service: "Dental Cleaning",
    reminderStatus: "pending",
  }))!;
}

const reload = async (a: AppointmentRow) => (await store.findAppointment(a.id))!;
const systemTexts = async (conversationId: string) =>
  (await testDb.db.select().from(messages)).filter((m) => m.conversationId === conversationId && m.origin === "system").map((m) => m.text);

test("dentro da janela, com a conversa aberta: um lembrete só, com nome, dia, hora e serviço", async () => {
  const conv = await conversation();
  const appt = await appointment();
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Hi Maria! Just a reminder of your appointment at DentalSafe on Wed, Oct 21 at 10:00 AM \(Dental Cleaning\)\. Please reply YES to confirm\.$/);
  const after = await reload(appt);
  assert.deepEqual([after.reminderStatus, after.reminderSentAt?.getTime()], ["sent", NOW.getTime()]);
  assert.deepEqual(await systemTexts(conv.id), ["🔔 Reminder sent for Wed, Oct 21 at 10:00 AM"]);
});

test("antes da janela: nada; quando ela abre, o lembrete sai", async () => {
  await conversation();
  const appt = await appointment("2026-10-22T10:00");
  await scheduler.tick();
  assert.equal(sent.length, 0);
  assert.equal((await reload(appt)).reminderReason, null);
  now = at("2026-10-21T11:00");
  // O portão é falso aqui: só a janela do lembrete conta
  await scheduler.tick();
  assert.equal(sent.length, 1);
});

test("fora da janela de 24 h do cliente ou sem conversa: lembrar manualmente, sem enviar nem registrar", async () => {
  const conv = await conversation();
  const appt = await appointment();
  blockReason = "outside_window";
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(sent.length, 0);
  assert.deepEqual([(await reload(appt)).reminderStatus, (await reload(appt)).reminderReason], ["pending", "outside_window"]);
  assert.deepEqual(await systemTexts(conv.id), []);

  const lonely = await appointment("2026-10-21T11:00", "5571977776666");
  await scheduler.tick();
  assert.equal((await reload(lonely)).reminderReason, "no_conversation");
});

test("a janela reabre (o cliente escreveu): o lembrete sai", async () => {
  await conversation();
  const appt = await appointment();
  blockReason = "outside_window";
  await scheduler.tick();
  blockReason = null;
  await scheduler.tick();
  assert.equal((await reload(appt)).reminderStatus, "sent");
});

test("cliente pediu para sair: não enviado na hora, com o motivo no histórico", async () => {
  const conv = await conversation();
  const appt = await appointment();
  blockReason = "opted_out";
  await scheduler.tick();
  assert.deepEqual([(await reload(appt)).reminderStatus, (await reload(appt)).reminderReason], ["not_sent", "opted_out"]);
  assert.deepEqual(await systemTexts(conv.id), [
    "🔔 Reminder not sent for Wed, Oct 21 at 10:00 AM: the customer asked not to receive messages",
  ]);
});

test("proteção pausada: espera e envia quando a pausa acaba", async () => {
  await conversation();
  const appt = await appointment();
  blockReason = "paused";
  await scheduler.tick();
  assert.deepEqual([(await reload(appt)).reminderStatus, (await reload(appt)).reminderReason], ["pending", "paused"]);
  blockReason = null;
  await scheduler.tick();
  assert.equal((await reload(appt)).reminderStatus, "sent");
});

test("mensagem do cliente sem resposta ou agendamento em andamento: espera", async () => {
  const conv = await conversation();
  const appt = await appointment();
  await inbox.recordIncoming({ kind: "message", id: "IN2", phone: PHONE, fromMe: false, type: "text", text: "one more thing", sentAt: new Date(now.getTime() + 1000) });
  await scheduler.tick();
  assert.equal(sent.length, 0);

  now = new Date(now.getTime() + 2000);
  const out = await inbox.startOutgoing({ conversationId: conv.id, origin: "assistant", text: "Sure" });
  await inbox.finishOutgoing(out.id, { waId: "OUT9" });
  await store.saveSession({ conversationId: conv.id, flow: "book", step: "choose_day" }, now);
  await scheduler.tick();
  assert.equal(sent.length, 0);

  await store.clearSession(conv.id);
  await scheduler.tick();
  assert.equal((await reload(appt)).reminderStatus, "sent");
});

test("apagado no Google: cancelado, sem lembrete; movido para longe: espera o horário novo", async () => {
  const conv = await conversation();
  const gone = await appointment();
  fake.events.delete(gone.googleEventId);
  await scheduler.tick();
  assert.equal((await reload(gone)).status, "cancelled");
  assert.ok((await systemTexts(conv.id)).includes("📅 Cancelled in the calendar: Wed, Oct 21 at 10:00 AM"));

  const moved = await appointment("2026-10-21T11:00");
  const event = fake.events.get(moved.googleEventId)!;
  event.start = at("2026-10-26T10:00");
  event.end = at("2026-10-26T11:00");
  await scheduler.tick();
  const after = await reload(moved);
  assert.deepEqual([after.startsAt.getTime(), after.reminderStatus], [at("2026-10-26T10:00").getTime(), "pending"]);
  assert.equal(sent.length, 0);
});

test("menos de 2 h antes: não enviado com o último motivo; uma vez só no histórico", async () => {
  const conv = await conversation();
  const appt = await appointment();
  blockReason = "outside_window";
  await scheduler.tick();
  now = at("2026-10-21T08:30");
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual([(await reload(appt)).reminderStatus, (await reload(appt)).reminderReason], ["not_sent", "outside_window"]);
  assert.deepEqual(await systemTexts(conv.id), [
    "🔔 Reminder not sent for Wed, Oct 21 at 10:00 AM: the customer has not written in over 24 h",
  ]);
});

test("confirmado pelo operador antes: nada sai", async () => {
  await conversation();
  const appt = await appointment();
  await store.confirm(appt.id, "operator", now);
  await scheduler.tick();
  assert.equal(sent.length, 0);
});

test("envio falhou: continua pendente com o motivo, e tenta no próximo passo", async () => {
  await conversation();
  const appt = await appointment();
  sendOutcome = "failed";
  await scheduler.tick();
  assert.deepEqual([(await reload(appt)).reminderStatus, (await reload(appt)).reminderReason], ["pending", "failed"]);
  sendOutcome = "sent";
  await scheduler.tick();
  assert.equal((await reload(appt)).reminderStatus, "sent");
});

test("agenda desconectada: espera, sem enviar", async () => {
  await conversation();
  await appointment();
  conn = null;
  await scheduler.tick();
  assert.equal(sent.length, 0);
});

test("variações: o mesmo texto não vai duas vezes para a mesma conversa", async () => {
  await conversation();
  await appointment();
  await scheduler.tick();
  // Remarcado: o horário novo tem o seu lembrete, com outra variação
  const [first] = await store.dueReminders(at("2026-10-30T00:00"));
  assert.equal(first, undefined);
  const again = await appointment("2026-10-21T14:00", PHONE);
  await store.markCancelled((await store.findFutureBooked(PHONE, now))!.id, "customer");
  await inbox.recordIncoming({ kind: "message", id: "IN3", phone: PHONE, fromMe: false, type: "text", text: "ok", sentAt: now });
  const out = await inbox.startOutgoing({ conversationId: (await repo.findConversationByPhone(PHONE))!.id, origin: "assistant", text: "Great" });
  await inbox.finishOutgoing(out.id, { waId: "OUT10" });
  await scheduler.tick();
  assert.equal((await reload(again)).reminderStatus, "sent");
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0].text, sent[1].text);
});
