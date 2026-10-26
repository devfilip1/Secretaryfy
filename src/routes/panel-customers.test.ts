import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { createCustomerRepository, type CustomerRepository } from "../modules/customers/repository.js";
import type { InboxEvent } from "../modules/inbox/events.js";
import { createInboxRepository, type InboxRepository } from "../modules/inbox/repository.js";
import { createInboxService } from "../modules/inbox/service.js";
import { createSchedulingStore, withAppointmentEvents, type SchedulingStore } from "../modules/scheduling/sessions.js";
import { createTestDb } from "../test/db.js";
import { createFakeCalendar, type FakeCalendar } from "../test/fake-calendar.js";
import { panelCustomersRoutes } from "./panel-customers.js";

const NOW = new Date("2026-10-20T18:00:00Z");
const PHONE = "5571999999999";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let repo: InboxRepository;
let customers: CustomerRepository;
let rawStore: SchedulingStore;
let fake: FakeCalendar;
let events: InboxEvent[];
let app: FastifyInstance;

before(async () => {
  testDb = await createTestDb();
  repo = createInboxRepository(testDb.db as never);
  customers = createCustomerRepository(testDb.db as never);
  rawStore = createSchedulingStore(testDb.db as never);
});
after(() => testDb.close());

beforeEach(async () => {
  await testDb.db.execute(sql`truncate table scheduling_sessions, appointments, customers, messages, conversations cascade`);
  events = [];
  fake = createFakeCalendar();
  const publish = (e: InboxEvent) => events.push(e);
  app = Fastify();
  await app.register(
    panelCustomersRoutes({
      customers,
      inbox: createInboxService({ repo, publish, now: () => NOW.getTime() }),
      inboxRepo: repo,
      store: withAppointmentEvents(rawStore, () => publish({ type: "appointments.updated" })),
      calendar: fake.gateway,
      publish,
      log: { warn: () => {} },
      now: () => NOW,
    }),
  );
});

/** Cliente com um horário futuro (evento na agenda falsa) e outro já passado. */
async function maria() {
  const customer = await customers.upsert({ phone: PHONE, name: "Maria", at: NOW });
  for (const [hoursAhead, service] of [
    [30, "Dental Cleaning"],
    [-30, "Teeth Whitening"],
  ] as const) {
    const start = new Date(NOW.getTime() + hoursAhead * 3_600_000);
    const end = new Date(start.getTime() + 3_600_000);
    const { eventId } = await fake.gateway.createEvent({ summary: `Maria — ${service}`, description: "", start, end, timeZone: "UTC", properties: {} });
    const appt = await rawStore.insertBooked({
      id: crypto.randomUUID(),
      conversationId: null,
      phone: PHONE,
      origin: "assistant",
      googleEventId: eventId,
      calendarId: "primary",
      startsAt: start,
      endsAt: end,
      customerName: "Maria",
      service,
      reminderStatus: "not_needed",
    });
    await rawStore.setCustomer(appt!.id, customer.id);
  }
  return customer;
}

const patch = (id: string, payload: unknown) => app.inject({ method: "PATCH", url: `/api/customers/${id}`, payload: payload as object });
const titles = () => [...fake.events.values()].map((e) => e.summary).sort();

test("GET /api/customers traz id, nome, telefone, anotações, conversa e agendamentos", async () => {
  const customer = await maria();
  const conv = await repo.upsertConversation({ phone: PHONE, name: ".", at: NOW, preview: "Oi" });
  await customers.update(customer.id, { notes: "allergic to latex" }, NOW);
  const [json] = (await app.inject({ url: "/api/customers" })).json().customers;
  assert.deepEqual(
    [json.id, json.name, json.phone, json.notes, json.conversationId, json.appointments.length],
    [customer.id, "Maria", PHONE, "allergic to latex", conv.id, 2],
  );
});

test("PATCH nome: cadastro, conversa e horários futuros com o nome novo; o título na agenda acompanha", async () => {
  const customer = await maria();
  const conv = await repo.upsertConversation({ phone: PHONE, name: ".", at: NOW, preview: "Oi" });
  const res = await patch(customer.id, { name: "  Maria Souza " });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.json().customer.name, res.json().calendarUpdated], ["Maria Souza", true]);
  assert.equal((await repo.findConversation(conv.id))?.customerName, "Maria Souza");
  // Só o evento futuro muda; o passado fica como estava
  assert.deepEqual(titles(), ["Maria Souza — Dental Cleaning", "Maria — Teeth Whitening"]);
  const future = await rawStore.futureBookedByPhone(PHONE, NOW);
  assert.equal(future[0].customerName, "Maria Souza");
  assert.ok(events.some((e) => e.type === "customers.updated"));
  assert.ok(events.some((e) => e.type === "appointments.updated"));
});

test("PATCH nome com o Google fora do ar: nome salvo, calendarUpdated false", async () => {
  const customer = await maria();
  fake.failNext();
  const res = await patch(customer.id, { name: "Maria Souza" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().calendarUpdated, false);
  assert.equal((await customers.findById(customer.id))?.name, "Maria Souza");
});

test("PATCH anotações: grava, troca e apaga; não mexe no nome nem na agenda", async () => {
  const customer = await maria();
  events = [];
  assert.equal((await patch(customer.id, { notes: "prefers mornings" })).json().customer.notes, "prefers mornings");
  assert.equal((await patch(customer.id, { notes: "   " })).json().customer.notes, null);
  assert.equal((await patch(customer.id, { notes: "allergic to latex" })).json().customer.notes, "allergic to latex");
  assert.equal((await patch(customer.id, { notes: null })).json().customer.notes, null);
  assert.equal(fake.calls.renameEvent, 0);
  assert.ok(!events.some((e) => e.type === "appointments.updated"));
});

test("PATCH inválido: 422 com o problema; desconhecido: 404", async () => {
  const customer = await maria();
  for (const payload of [{ name: "   " }, { notes: "x".repeat(1001) }, {}, { phone: "5511" }]) {
    const res = await patch(customer.id, payload);
    assert.equal(res.statusCode, 422, JSON.stringify(payload));
    assert.equal(res.json().error, "invalid_body");
  }
  assert.equal((await customers.findById(customer.id))?.name, "Maria");
  assert.equal((await patch("00000000-0000-4000-8000-000000000000", { name: "X" })).statusCode, 404);
  assert.equal((await patch("nao-e-uuid", { name: "X" })).statusCode, 404);
});

test("DELETE /api/customers/:id exclui, faz a conversa esquecer o nome e avisa o painel", async () => {
  const customer = await maria();
  const conv = await repo.upsertConversation({ phone: PHONE, name: ".", at: NOW, preview: "Oi" });
  await repo.setCustomerName(conv.id, "Maria");
  const res = await app.inject({ method: "DELETE", url: `/api/customers/${customer.id}` });
  assert.equal(res.statusCode, 204);
  assert.equal(await customers.findById(customer.id), null);
  assert.equal((await repo.findConversation(conv.id))?.customerName, null);
  assert.ok(events.some((e) => e.type === "customers.updated"));
  // Os horários continuam
  assert.equal((await rawStore.futureBookedByPhone(PHONE, NOW)).length, 1);
});

test("DELETE de cadastro inexistente ou id inválido: 404", async () => {
  for (const id of ["00000000-0000-4000-8000-000000000000", "nao-e-uuid"]) {
    assert.equal((await app.inject({ method: "DELETE", url: `/api/customers/${id}` })).statusCode, 404);
  }
  assert.deepEqual(events, []);
});
