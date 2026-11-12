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
import { createCatalog, type ServiceCatalog } from "../modules/scheduling/catalog.js";
import { DEFAULT_RULES } from "../modules/scheduling/rules.js";
import { testCatalog } from "../test/catalog.js";
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

/** O painel com este catálogo: a marcação e a lista usam os mesmos títulos */
async function panelWith(catalog: ServiceCatalog): Promise<FastifyInstance> {
  const deps = {
    calendar: fake.gateway,
    connection: { getForUse: async () => conn },
    rules: { get: async () => ({ ...DEFAULT_RULES }) },
    store,
    inbox,
    customers,
    log: { error: () => {} },
    now: () => now,
    catalog,
  };
  const server = Fastify();
  await server.register(
    panelAppointmentsRoutes({
      ...deps,
      inboxRepo: repo,
      booking: createBooking(deps),
      reminderLeadMinutes: 1440,
      catalog,
    }),
  );
  return server;
}

beforeEach(async () => {
  await testDb.db.execute(sql`truncate table scheduling_sessions, appointments, customers, messages, conversations cascade`);
  events = [];
  sent = [];
  now = NOW;
  conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" };
  fake = createFakeCalendar();
  inbox = createInboxService({ repo, publish: (e) => events.push(e), now: () => now.getTime() });
  store = withAppointmentEvents(rawStore, () => events.push({ type: "appointments.updated" }));
  app = await panelWith(testCatalog);
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

test("GET /api/appointments?days: a janela cresce com days (padrão 7); fora de 1 a 31 é 422", async () => {
  await book({ ...VALID, start: at("2026-10-20T17:00").toISOString() });
  await book({ ...VALID, phone: "71 97777-6666", name: "Ana", service: "Assessment", start: at("2026-10-27T11:00").toISOString() });
  await book({ ...VALID, phone: "71 96666-5555", name: "Bia", start: at("2026-11-05T10:00").toISOString() });
  const names = async (query: string) =>
    (await app.inject({ url: `/api/appointments${query}` })).json().appointments.map((a: { customerName: string }) => a.customerName);

  assert.deepEqual(await names("?days=3"), ["Maria Souza"]);
  assert.deepEqual(await names(""), ["Maria Souza", "Ana"]);
  assert.deepEqual(await names("?days=31"), ["Maria Souza", "Ana", "Bia"]);
  for (const query of ["?days=0", "?days=32", "?days=abc", "?days=1.5"]) {
    assert.equal((await app.inject({ url: `/api/appointments${query}` })).statusCode, 422, query);
  }
});

test("GET /api/appointments?from=today: inclui os de hoje já passados, com a situação; sem from, só os futuros", async () => {
  now = at("2026-10-20T08:00");
  await book({ ...VALID, start: at("2026-10-20T17:00").toISOString() });
  await book({ ...VALID, phone: "71 98888-7777", name: "João", start: at("2026-10-21T09:00").toISOString() });
  // Passou das 17h: o horário de hoje já aconteceu, mas continua marcado
  now = at("2026-10-20T18:00");
  const names = async (query: string) =>
    (await app.inject({ url: `/api/appointments${query}` })).json().appointments.map((a: { customerName: string }) => a.customerName);

  assert.deepEqual(await names(""), ["João"]);
  assert.deepEqual(await names("?from=today"), ["Maria Souza", "João"]);
  const [past] = (await app.inject({ url: "/api/appointments?from=today" })).json().appointments;
  assert.deepEqual([past.startsAt, past.status], [at("2026-10-20T17:00").toISOString(), "booked"]);
  assert.equal(past.group, "today");
  assert.equal((await app.inject({ url: "/api/appointments?from=amanha" })).statusCode, 422);
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
  const notes = (await testDb.db.select().from(messages)).filter((m) => m.conversationId === conv.id).map((m) => m.note);
  assert.deepEqual(notes, [{ kind: "booked_from_panel", start: "2026-10-22T13:00:00.000Z", minutes: 60, service: "Dental Cleaning", timeZone: "America/Bahia" }]);
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

test("GET /api/booking/days: chips da janela do paciente, com minDate e maxDate da equipe (um ano)", async () => {
  const body = (await app.inject({ url: "/api/booking/days" })).json();
  assert.equal(body.minDate, "2026-10-20");
  assert.equal(body.maxDate, "2027-10-20");
  assert.ok(body.days.length > 0);
  assert.ok(body.days.every((d: string) => d <= "2026-11-19"));
});

test("GET /api/booking/days: status cobre a janela da equipe, além dos 30 dias do paciente", async () => {
  const { status } = (await app.inject({ url: "/api/booking/days" })).json();
  assert.equal(status["2026-10-21"], "free");
  // Dia 100, fora da janela do paciente; e o último dia da equipe
  assert.equal(status["2027-01-28"], "free");
  assert.equal(status["2027-10-20"], "free");
  assert.equal(status["2027-10-21"], undefined);
  // 25/10/2026 é domingo: fechado, fora do mapa
  assert.equal("2026-10-25" in status, false);
});

test("GET /api/booking/days?service: a duração do tratamento muda o estado do dia", async () => {
  // Gaps de 30 min: cabe um tratamento de 30, não um de 60
  for (let h = 9; h < 18; h++) {
    const hh = String(h).padStart(2, "0");
    const next = String(h + 1).padStart(2, "0");
    fake.block(at(`2026-10-21T${hh}:30`), at(`2026-10-21T${next}:00`));
  }
  const timed = await panelWith(
    createCatalog([
      { name: "Dental Cleaning", label: "Dental Cleaning", minutes: 30 },
      { name: "Dental Implants", label: "Dental Implants", minutes: 60 },
    ]),
  );
  const short = (await timed.inject({ url: `/api/booking/days?service=${encodeURIComponent("Dental Cleaning")}` })).json();
  const long = (await timed.inject({ url: `/api/booking/days?service=${encodeURIComponent("Dental Implants")}` })).json();
  const none = (await app.inject({ url: "/api/booking/days" })).json();
  await timed.close();
  assert.equal(short.status["2026-10-21"], "free");
  assert.equal(long.status["2026-10-21"], "full");
  // Sem service, vale a duração padrão (60 min) do catálogo de testes
  assert.equal(none.status["2026-10-21"], "full");
});

test("GET /api/booking/days: a forma de days não muda com o service", async () => {
  const plain = (await app.inject({ url: "/api/booking/days" })).json();
  const withService = (await app.inject({ url: `/api/booking/days?service=${encodeURIComponent("Dental Cleaning")}` })).json();
  assert.deepEqual(Object.keys(plain).sort(), ["days", "maxDate", "minDate", "status", "timeZone"]);
  assert.deepEqual(Object.keys(withService).sort(), ["days", "maxDate", "minDate", "status", "timeZone"]);
  assert.deepEqual(withService.days, plain.days);
});

test("GET /api/booking/slots: a equipe vê os horários até maxDate; antes de hoje e depois dele, lista vazia", async () => {
  const later = (await app.inject({ url: "/api/booking/slots?date=2027-01-28" })).json();
  assert.equal(later.slots[0], at("2027-01-28T09:00").toISOString());
  assert.deepEqual((await app.inject({ url: "/api/booking/slots?date=2027-10-21" })).json().slots, []);
  assert.deepEqual((await app.inject({ url: "/api/booking/slots?date=2026-10-19" })).json().slots, []);
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

test("GET /api/services: os serviços na ordem do assistente, com a avaliação geral em inglês", async () => {
  const { services } = (await app.inject({ url: "/api/services" })).json();
  assert.deepEqual(
    services.map((s: { name: string }) => s.name),
    testCatalog.list().map((s) => s.name),
  );
  assert.equal(services.at(-1).label, "General assessment");
  assert.equal(services[0].label, "Dental Cleaning");
});

test("o painel mostra o título do tratamento no catálogo; um nome fora dele aparece como está", async () => {
  // Antes da troca de catálogo, marcado com o nome que o catálogo de teste conhece
  await book(VALID);
  const titled = await panelWith(createCatalog([{ name: "limpeza-dental", label: "Limpeza dental" }]));
  const created = await titled.inject({ method: "POST", url: "/api/appointments", payload: { ...VALID, phone: "71 98888-7777", name: "João", service: "limpeza-dental", start: at("2026-10-23T10:00").toISOString() } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().appointment.service, "Limpeza dental");
  assert.equal([...fake.events.values()].at(-1)?.summary, "João — Limpeza dental");
  const services = (await titled.inject({ url: "/api/appointments" })).json().appointments.map((a: { service: string }) => a.service);
  assert.deepEqual(services, ["Dental Cleaning", "Limpeza dental"]);
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
  const notes = (await testDb.db.select().from(messages)).filter((m) => m.conversationId === conv.id).map((m) => m.note);
  assert.equal(notes.filter((n) => n?.kind === "confirmed_by_operator").length, 1);
});

test("confirmar horário inexistente, passado ou cancelado: 404", async () => {
  assert.equal((await app.inject({ method: "POST", url: "/api/appointments/nao-e-uuid/confirm" })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/appointments/00000000-0000-4000-8000-000000000000/confirm" })).statusCode, 404);
  const { appointment } = (await book(VALID)).json();
  now = at("2026-10-23T10:00");
  assert.equal((await app.inject({ method: "POST", url: `/api/appointments/${appointment.id}/confirm` })).statusCode, 404);
});

// --- Duração escolhida pela equipe, inícios com a duração máxima e cancelamento pela equipe ---

const cancel = (id: string) => app.inject({ method: "POST", url: `/api/appointments/${id}/cancel` });
const startsOn = (date: string) => app.inject({ url: `/api/booking/starts?date=${date}` });

test("GET /api/appointments: endsAt e minutes, o tempo que o horário bloqueia de verdade", async () => {
  await book(VALID);
  await book({ ...VALID, phone: "71 98888-7777", name: "João", start: at("2026-10-21T09:00").toISOString(), minutes: 20 });
  const body = (await app.inject({ url: "/api/appointments" })).json();
  assert.deepEqual(
    body.appointments.map((a: { customerName: string; startsAt: string; endsAt: string; minutes: number }) => [a.customerName, a.startsAt, a.endsAt, a.minutes]),
    [
      ["João", at("2026-10-21T09:00").toISOString(), at("2026-10-21T09:20").toISOString(), 20],
      ["Maria Souza", at("2026-10-22T10:00").toISOString(), at("2026-10-22T11:00").toISOString(), 60],
    ],
  );
});

test("GET /api/booking/slots: minutes é a duração usada, a do tratamento ou a padrão", async () => {
  const short = await panelWith(createCatalog([{ name: "limpeza-dental", label: "Limpeza dental", minutes: 30 }]));
  const withService = (await short.inject({ url: "/api/booking/slots?date=2026-10-22&service=limpeza-dental" })).json();
  assert.equal(withService.minutes, 30);
  const plain = (await app.inject({ url: "/api/booking/slots?date=2026-10-22" })).json();
  assert.deepEqual([plain.date, plain.minutes], ["2026-10-22", 60]);
  assert.equal(plain.slots.includes(at("2026-10-22T10:00").toISOString()), true);
});

test("GET /api/booking/starts: inícios livres com a duração máxima de cada um", async () => {
  fake.block(at("2026-10-21T11:00"), at("2026-10-21T12:00"));
  const body = (await startsOn("2026-10-21")).json();
  assert.equal(body.date, "2026-10-21");
  const maxOf = (local: string) => body.starts.find((s: { start: string }) => s.start === at(local).toISOString())?.maxMinutes ?? null;
  assert.equal(maxOf("2026-10-21T09:00"), 120); // até o 11:00 ocupado
  assert.equal(maxOf("2026-10-21T10:00"), 60);
  assert.equal(maxOf("2026-10-21T11:00"), null); // ocupado
  assert.equal(maxOf("2026-10-21T12:00"), 360); // até o fechamento das 18:00
  assert.deepEqual(Object.keys(body.starts[0]), ["start", "maxMinutes"]);
  // Dia com a agenda livre: o teto de 480 min
  assert.equal((await startsOn("2026-10-22")).json().starts.find((s: { start: string }) => s.start === at("2026-10-22T09:00").toISOString()).maxMinutes, 480);
  // Antes de hoje, e depois da janela da equipe, não há inícios
  assert.deepEqual((await startsOn("2026-10-19")).json().starts, []);
  assert.deepEqual((await startsOn("2027-10-21")).json().starts, []);
});

test("GET /api/booking/starts: data inválida, 422; agenda desconectada, 409", async () => {
  const bad = await startsOn("quinta");
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json().error, "invalid_date");
  conn = null;
  const off = await startsOn("2026-10-21");
  assert.equal(off.statusCode, 409);
  assert.equal(off.json().error, "calendar_disconnected");
});

test("POST /api/appointments com minutes: a duração vale; fora de 5 a 480 ou sem múltiplo de 5, 422", async () => {
  const res = await book({ ...VALID, minutes: 20 });
  assert.equal(res.statusCode, 201);
  assert.deepEqual([res.json().appointment.minutes, res.json().appointment.endsAt], [20, at("2026-10-22T10:20").toISOString()]);
  assert.equal([...fake.events.values()][0].end.getTime(), at("2026-10-22T10:20").getTime());

  for (const minutes of [0, 3, 22, 485, "20", null]) {
    const bad = await book({ ...VALID, phone: "71 97777-6666", minutes });
    assert.equal(bad.statusCode, 422, `minutes=${JSON.stringify(minutes)}`);
    assert.equal(bad.json().error, "invalid_body");
  }
});

test("POST com minutes além da folga até a próxima ocupação: 409 slot_taken, com os horários dessa duração", async () => {
  fake.block(at("2026-10-22T10:30"), at("2026-10-22T11:00"));
  const res = await book({ ...VALID, minutes: 45 });
  assert.equal(res.statusCode, 409);
  const body = res.json();
  assert.deepEqual([body.error, body.date], ["slot_taken", "2026-10-22"]);
  assert.equal(body.slots.includes(at("2026-10-22T10:00").toISOString()), false);
  assert.equal(fake.events.size, 0);
});

test("POST /api/appointments/:id/cancel: 200, o horário sai da lista, a aba é avisada e o cliente não recebe nada", async () => {
  const { appointment } = (await book(VALID)).json();
  events = [];
  const res = await cancel(appointment.id);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(fake.events.size, 0);
  assert.ok(events.some((e) => e.type === "appointments.updated"));
  assert.deepEqual((await app.inject({ url: "/api/appointments" })).json().appointments, []);
  assert.deepEqual(sent, []);
});

test("POST cancel: 404 para inexistente, não uuid, já cancelado e já passado; 409 com a agenda desconectada", async () => {
  assert.equal((await cancel("nao-e-uuid")).statusCode, 404);
  assert.equal((await cancel("00000000-0000-4000-8000-000000000000")).json().error, "not_found");

  const passed = (await book(VALID)).json().appointment;
  now = at("2026-10-22T10:30");
  assert.equal((await cancel(passed.id)).json().error, "not_found");
  now = NOW;

  assert.equal((await cancel(passed.id)).statusCode, 200);
  assert.equal((await cancel(passed.id)).statusCode, 404);

  const kept = (await book({ ...VALID, phone: "71 98888-7777", name: "João" })).json().appointment;
  conn = null;
  const off = await cancel(kept.id);
  assert.equal(off.statusCode, 409);
  assert.equal(off.json().error, "calendar_disconnected");
});
