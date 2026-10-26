import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { createTestDb } from "../../test/db.js";
import { createCustomerRepository, type CustomerRepository } from "../customers/repository.js";
import { createInboxRepository, type InboxRepository } from "../inbox/repository.js";
import { createSchedulingStore, type SchedulingStore } from "./sessions.js";

let close: () => Promise<unknown>;
let store: SchedulingStore;
let inbox: InboxRepository;
let customers: CustomerRepository;
let reset: () => Promise<unknown>;

before(async () => {
  const testDb = await createTestDb();
  close = testDb.close;
  store = createSchedulingStore(testDb.db as never);
  inbox = createInboxRepository(testDb.db as never);
  customers = createCustomerRepository(testDb.db as never);
  reset = () => testDb.db.execute(sql`truncate table scheduling_sessions, appointments, customers, messages, conversations cascade`);
});
after(() => close());
beforeEach(() => reset());

const now = new Date("2026-10-20T15:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);
const PHONE = "5571999999999";

async function conversation(phone = PHONE) {
  return inbox.upsertConversation({ phone, name: "Perfil", at: now, preview: "Oi" });
}

async function book(over: Partial<Parameters<SchedulingStore["insertBooked"]>[0]> = {}) {
  const start = over.startsAt ?? hours(30);
  const row = await store.insertBooked({
    id: randomUUID(),
    conversationId: null,
    phone: PHONE,
    origin: "assistant",
    googleEventId: randomUUID(),
    calendarId: "primary",
    startsAt: start,
    endsAt: new Date(start.getTime() + 3_600_000),
    customerName: "Maria",
    service: "Dental Cleaning",
    reminderStatus: "pending",
    ...over,
  });
  assert.ok(row);
  return row;
}

test("findFutureBooked acha pelo telefone, de outra conversa ou sem conversa nenhuma", async () => {
  const other = await conversation();
  const fromOther = await book({ conversationId: other.id });
  assert.equal((await store.findFutureBooked(PHONE, now))?.id, fromOther.id);
  await store.markCancelled(fromOther.id, "customer");

  const fromPanel = await book({ conversationId: null, origin: "panel", startsAt: hours(50) });
  assert.equal((await store.findFutureBooked(PHONE, now))?.id, fromPanel.id);
  assert.equal(await store.findFutureBooked("5511000000000", now), null);
  assert.equal(await store.findFutureBooked(PHONE, hours(60)), null);
});

test("apagar a conversa mantém o agendamento, sem o vínculo", async () => {
  const conv = await conversation();
  const appt = await book({ conversationId: conv.id });
  await inbox.deleteAllConversations();
  const kept = await store.findAppointment(appt.id);
  assert.ok(kept);
  assert.equal(kept.conversationId, null);
  assert.equal(kept.phone, PHONE);
});

test("updateTimes recalcula o lembrete e limpa a confirmação", async () => {
  const appt = await book();
  await store.markReminderSent(appt.id, now);
  await store.confirm(appt.id, "customer", now);
  assert.ok(await store.updateTimes(appt.id, hours(80), hours(81), "pending"));
  const moved = await store.findAppointment(appt.id);
  assert.deepEqual(
    [moved?.startsAt, moved?.reminderStatus, moved?.reminderSentAt, moved?.confirmedAt, moved?.confirmedBy],
    [hours(80), "pending", null, null, null],
  );
});

test("listUpcoming: só os marcados no intervalo, em ordem, com as anotações do cliente", async () => {
  const maria = await customers.upsert({ phone: PHONE, name: "Maria Souza", at: now });
  await customers.update(maria.id, { notes: "allergic to latex" }, now);
  const later = await book({ startsAt: hours(50) });
  await store.setCustomer(later.id, maria.id);
  const sooner = await book({ startsAt: hours(5), phone: "5511988887777", customerName: "João" });
  const cancelled = await book({ startsAt: hours(10), phone: "5511977776666" });
  await store.markCancelled(cancelled.id, "customer");
  await book({ startsAt: hours(300), phone: "5511966665555" });
  await book({ startsAt: hours(-2), phone: "5511955554444" });

  const list = await store.listUpcoming(now, hours(24 * 8));
  assert.deepEqual(
    list.map((a) => a.id),
    [sooner.id, later.id],
  );
  assert.equal(list[1].notes, "allergic to latex");
  assert.equal(list[1].registeredName, "Maria Souza");
  assert.equal(list[0].notes, null);
});

test("listUpcoming acha as anotações pelo telefone quando o vínculo caiu", async () => {
  await book({ startsAt: hours(5) });
  const maria = await customers.upsert({ phone: PHONE, name: "Maria", at: now });
  await customers.update(maria.id, { notes: "prefers mornings" }, now);
  const [item] = await store.listUpcoming(now, hours(24));
  assert.equal(item.notes, "prefers mornings");
});

test("lembrete: vencidos, enviado uma vez só, motivo e não enviado", async () => {
  const due = await book({ startsAt: hours(10) });
  await book({ startsAt: hours(40), phone: "5511988887777" });
  await book({ startsAt: hours(5), phone: "5511977776666", reminderStatus: "not_needed" });

  assert.deepEqual(
    (await store.dueReminders(hours(24))).map((a) => a.id),
    [due.id],
  );
  await store.setReminderReason(due.id, "outside_window");
  assert.equal((await store.findAppointment(due.id))?.reminderReason, "outside_window");

  assert.equal(await store.markReminderSent(due.id, now), true);
  assert.equal(await store.markReminderSent(due.id, now), false);
  const sent = await store.findAppointment(due.id);
  assert.deepEqual([sent?.reminderStatus, sent?.reminderReason, sent?.reminderSentAt], ["sent", null, now]);
  assert.equal(await store.markReminderNotSent(due.id, "too_late"), false);
  assert.deepEqual(await store.dueReminders(hours(24)), []);
});

test("confirmar: grava quem confirmou, e um lembrete pendente deixa de ser necessário", async () => {
  const pending = await book();
  const confirmed = await store.confirm(pending.id, "operator", now);
  assert.deepEqual([confirmed?.confirmedBy, confirmed?.reminderStatus], ["operator", "not_needed"]);
  // Confirmar de novo não muda nada
  const again = await store.confirm(pending.id, "customer", hours(1));
  assert.deepEqual([again?.confirmedBy, again?.confirmedAt], ["operator", now]);
  assert.equal(await store.confirm(randomUUID(), "operator", now), null);
});

test("findReminderAwaiting: lembrete enviado, futuro e ainda sem confirmação", async () => {
  const appt = await book();
  assert.equal(await store.findReminderAwaiting(PHONE, now), null);
  await store.markReminderSent(appt.id, now);
  assert.equal((await store.findReminderAwaiting(PHONE, now))?.id, appt.id);
  await store.confirm(appt.id, "customer", now);
  assert.equal(await store.findReminderAwaiting(PHONE, now), null);
});
