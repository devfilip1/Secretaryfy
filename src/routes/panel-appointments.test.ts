import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { messages } from "../db/schema.js";
import { createCustomerRepository, type CustomerRepository } from "../modules/customers/repository.js";
import type { ActiveConnection } from "../modules/google/connection.js";
import type { InboxEvent } from "../modules/inbox/events.js";
import { createInboxRepository, type InboxRepository } from "../modules/inbox/repository.js";
import { createInboxService, type InboxService } from "../modules/inbox/service.js";
import { createBooking } from "../modules/scheduling/booking.js";
import { DEFAULT_RULES } from "../modules/scheduling/rules.js";
import { createSchedulingStore, withAppointmentEvents, type SchedulingStore } from "../modules/scheduling/sessions.js";
import { createTestDb } from "../test/db.js";
import { createFakeCalendar, type FakeCalendar } from "../test/fake-calendar.js";
import { panelAppointmentsRoutes } from "./panel-appointments.js";

const tz = "America/Bahia";
// Terça, 20/10/2026, 15:00 em Salvador
const NOW = new Date("2026-10-20T18:00:00Z");
const at = (local: string) => new Date(`${local}-03:00`);
const PHONE = "5571999999999";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let repo: InboxRepository;
let customers: CustomerRepository;
let rawStore: SchedulingStore;
let store: SchedulingStore;
let inbox: InboxService;
let fake: FakeCalendar;
let conn: ActiveConnection | null;
let events: InboxEvent[];
let sent: string[];
let now: Date;
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
  sent = [];
  now = NOW;
  conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" };
  fake = createFakeCalendar();
  inbox = createInboxService({ repo, publish: (e) => events.push(e), now: () => now.getTime() });
  store = withAppointmentEvents(rawStore, () => events.push({ type: "appointments.updated" }));
  const deps = {
    calendar: fake.gateway,
    connection: { getForUse: async () => conn },
    rules: { get: async () => ({ ...DEFAULT_RULES }) },
    store,
    inbox,
    customers,
    log: { error: () => {} },
    now: () => now,
  };
  app = Fastify();
  await app.register(
    panelAppointmentsRoutes({
      ...deps,
      inboxRepo: repo,
      booking: createBooking(deps),
      reminderLeadMinutes: 1440,
    }),
  );
});

const conversation = (phone = PHONE) => repo.upsertConversation({ phone, name: "Perfil", at: now, preview: "Oi" });
const book = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/appointments", payload: body });
const VALID = { phone: "(71) 99999-9999", name: "Maria Souza", service: "Dental Cleaning", start: at("2026-10-22T10:00").toISOString() };

// --- US1: aba Appointments ---

test("GET /api/appointments: hoje, amanhã e semana no fuso da clínica, com conversa, notas e situação do lembrete", async () => {
  const conv = await conversation();
  await book({ ...VALID, start: at("2026-10-20T17:00").toISOString() });
  await book({ ...VALID, phone: "71 98888-7777", name: "João", start: at("2026-10-21T09:00").toISOString() });
  await book({ ...VALID, phone: "71 97777-6666", name: "Ana", service: "Assessment", start: at("2026-10-27T11:00").toISOString() });
  // Fora da semana
  await book({ ...VALID, phone: "71 96666-5555", name: "Bia", start: at("2026-11-05T10:00").toISOString() });
  const maria = (await customers.findByPhone(PHONE))!;
  await customers.update(maria.id, { notes: "allergic to latex" }, now);

  const res = await app.inject({ url: "/api/appointments" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.timeZone, tz);
  assert.deepEqual(
    body.appointments.map((a: { customerName: string; group: string }) => [a.customerName, a.group]),
    [
      ["Maria Souza", "today"],
      ["João", "tomorrow"],
      ["Ana", "week"],
    ],
  );
  const [first, second, third] = body.appointments;
  assert.deepEqual(
    [first.phone, first.service, first.notes, first.conversationId, first.origin, first.reminder.label],
    [PHONE, "Dental Cleaning", "allergic to latex", conv.id, "panel", "not_needed"],
  );
  assert.equal(second.conversationId, null);
  assert.equal(third.reminder.label, "scheduled");
});

test("GET /api/appointments sem agenda conectada: a lista do banco no fuso de reserva", async () => {
  await book(VALID);
  conn = null;
  const body = (await app.inject({ url: "/api/appointments" })).json();
  assert.equal(body.timeZone, "America/Sao_Paulo");
  assert.equal(body.appointments.length, 1);
});

// --- US3: marcar pelo painel ---

test("POST /api/appointments: cria o evento, o agendamento e o cadastro, sem mandar nada ao cliente", async () => {
  const res = await book(VALID);
  assert.equal(res.statusCode, 201);
  const { appointment } = res.json();
  assert.deepEqual(
    [appointment.phone, appointment.customerName, appointment.service, appointment.origin, appointment.reminder.label],
    [PHONE, "Maria Souza", "Dental Cleaning", "panel", "scheduled"],
  );
  const [event] = [...fake.events.values()];
  assert.equal(event.summary, "Maria Souza — Dental Cleaning");
  assert.match(event.description, /Marcado pelo Secretaryfy \(painel\)\./);
  assert.equal((await customers.findByPhone(PHONE))?.name, "Maria Souza");
  assert.ok(events.some((e) => e.type === "appointments.updated"));
  assert.deepEqual(sent, []);
});

test("POST /api/appointments com conversa no telefone: registro no histórico", async () => {
  const conv = await conversation();
  await book(VALID);
  const notes = (await testDb.db.select().from(messages)).filter((m) => m.conversationId === conv.id).map((m) => m.text);
  assert.deepEqual(notes, ["📅 Booked from the panel: Thu, Oct 22 at 10:00 AM (60 min) — Dental Cleaning"]);
});

test("POST /api/appointments: um horário futuro por telefone, como o assistente", async () => {
  await book(VALID);
  const res = await book({ ...VALID, start: at("2026-10-23T10:00").toISOString() });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "already_booked");
  assert.equal(res.json().appointment.startsAt, at("2026-10-22T10:00").toISOString());
});

test("POST /api/appointments com o horário ocupado: slot_taken e os horários livres do dia", async () => {
  fake.block(at("2026-10-22T10:00"), at("2026-10-22T11:00"));
  const res = await book(VALID);
  assert.equal(res.statusCode, 409);
  const body = res.json();
  assert.equal(body.error, "slot_taken");
  assert.equal(body.date, "2026-10-22");
  assert.ok(!body.slots.includes(at("2026-10-22T10:00").toISOString()));
  assert.ok(body.slots.includes(at("2026-10-22T11:00").toISOString()));
  assert.equal(fake.events.size, 0);
});

test("POST /api/appointments fora das regras (domingo) também é slot_taken", async () => {
  const res = await book({ ...VALID, start: at("2026-10-25T10:00").toISOString() });
  assert.equal(res.json().error, "slot_taken");
});

test("POST /api/appointments: agenda desconectada (409) e Google fora do ar (502)", async () => {
  conn = { ...conn!, status: "needs_reauth" };
  assert.equal((await book(VALID)).json().error, "calendar_disconnected");
  conn = { ...conn, status: "connected" };
  fake.failNext();
  const res = await book(VALID);
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, "calendar_unavailable");
});

test("POST /api/appointments inválido: 422 com o campo de cada problema", async () => {
  const res = await book({ phone: "123", name: "  ", service: "Massage", start: "amanhã" });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.json().issues.map((i: { path: string }) => i.path).sort(), ["name", "phone", "service", "start"]);
});

test("GET /api/booking/days e /slots: os mesmos horários livres do assistente", async () => {
  fake.block(at("2026-10-21T09:00"), at("2026-10-21T18:00"));
  const days = (await app.inject({ url: "/api/booking/days" })).json();
  assert.equal(days.timeZone, tz);
  assert.equal(days.days[0], "2026-10-20");
  assert.ok(!days.days.includes("2026-10-21"));

  const slots = (await app.inject({ url: "/api/booking/slots?date=2026-10-22" })).json();
  assert.equal(slots.slots.length, 9);
  assert.equal(slots.slots[0], at("2026-10-22T09:00").toISOString());
  assert.deepEqual((await app.inject({ url: "/api/booking/slots?date=2026-10-25" })).json().slots, []);
  assert.equal((await app.inject({ url: "/api/booking/slots?date=quinta" })).statusCode, 422);

  conn = null;
  assert.equal((await app.inject({ url: "/api/booking/days" })).statusCode, 409);
});

test("GET /api/booking/lookup: telefone normalizado, nome conhecido e horário futuro", async () => {
  const conv = await conversation();
  await repo.setCustomerName(conv.id, "Maria");
  let body = (await app.inject({ url: `/api/booking/lookup?phone=${encodeURIComponent("(71) 99999-9999")}` })).json();
  assert.deepEqual([body.phone, body.name, body.hasConversation, body.futureAppointment], [PHONE, "Maria", true, null]);

  await book(VALID);
  body = (await app.inject({ url: `/api/booking/lookup?phone=${PHONE}` })).json();
  assert.equal(body.name, "Maria Souza");
  assert.equal(body.futureAppointment.startsAt, at("2026-10-22T10:00").toISOString());

  assert.equal((await app.inject({ url: "/api/booking/lookup?phone=12" })).statusCode, 422);
});

// --- US4: confirmação pelo operador ---

test("POST /api/appointments/:id/confirm: confirma, o lembrete pendente deixa de ser necessário, uma vez só", async () => {
  const conv = await conversation();
  const { appointment } = (await book(VALID)).json();
  events = [];
  const res = await app.inject({ method: "POST", url: `/api/appointments/${appointment.id}/confirm` });
  assert.equal(res.statusCode, 200);
  const confirmed = res.json().appointment;
  assert.deepEqual([confirmed.reminder.label, confirmed.confirmedBy], ["confirmed", "operator"]);
  assert.equal((await store.findAppointment(appointment.id))?.reminderStatus, "not_needed");
  assert.ok(events.some((e) => e.type === "appointments.updated"));

  await app.inject({ method: "POST", url: `/api/appointments/${appointment.id}/confirm` });
  const notes = (await testDb.db.select().from(messages)).filter((m) => m.conversationId === conv.id).map((m) => m.text);
  assert.equal(notes.filter((t) => t?.startsWith("✅ Appointment confirmed by the operator")).length, 1);
});

test("confirmar horário inexistente, passado ou cancelado: 404", async () => {
  assert.equal((await app.inject({ method: "POST", url: "/api/appointments/nao-e-uuid/confirm" })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/appointments/00000000-0000-4000-8000-000000000000/confirm" })).statusCode, 404);
  const { appointment } = (await book(VALID)).json();
  now = at("2026-10-23T10:00");
  assert.equal((await app.inject({ method: "POST", url: `/api/appointments/${appointment.id}/confirm` })).statusCode, 404);
});
