import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { appointments, messages } from "../../db/schema.js";
import { createTestDb } from "../../test/db.js";
import { createFakeCalendar, type FakeCalendar } from "../../test/fake-calendar.js";
import { createCustomerRepository, type CustomerRepository } from "../customers/repository.js";
import type { ActiveConnection } from "../google/connection.js";
import { createInboxRepository, type InboxRepository } from "../inbox/repository.js";
import { createInboxService } from "../inbox/service.js";
import { testCatalog } from "../../test/catalog.js";
import { createBooking, type Booking } from "./booking.js";
import { createCatalog, type ServiceCatalog } from "./catalog.js";
import { DEFAULT_RULES } from "./rules.js";
import { createSchedulingStore, type SchedulingStore } from "./sessions.js";

const tz = "America/Bahia";
// Terça, 20/10/2026, 15:00 em Salvador
const NOW = new Date("2026-10-20T18:00:00Z");
const at = (local: string) => new Date(`${local}-03:00`);
const PHONE = "5571999999999";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let repo: InboxRepository;
let store: SchedulingStore;
let customers: CustomerRepository;
let fake: FakeCalendar;
let conn: ActiveConnection | null;
let booking: Booking;

before(async () => {
  testDb = await createTestDb();
  repo = createInboxRepository(testDb.db as never);
  store = createSchedulingStore(testDb.db as never);
  customers = createCustomerRepository(testDb.db as never);
});
after(() => testDb.close());

/** O motor de marcação com este catálogo (os títulos vêm dele) */
const engine = (catalog: ServiceCatalog, clock: Date = NOW) =>
  createBooking({
    calendar: fake.gateway,
    connection: { getForUse: async () => conn },
    rules: { get: async () => ({ ...DEFAULT_RULES }) },
    store,
    inbox: createInboxService({ repo, publish: () => {}, now: () => NOW.getTime() }),
    customers,
    log: { error: () => {} },
    now: () => clock,
    catalog,
  });

beforeEach(async () => {
  await testDb.db.execute(sql`truncate table scheduling_sessions, appointments, customers, messages, conversations cascade`);
  conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" };
  fake = createFakeCalendar();
  booking = engine(testCatalog);
});

const slot = (local = "2026-10-22T10:00", over: Partial<Parameters<Booking["bookSlot"]>[0]> = {}) =>
  booking.bookSlot({ phone: PHONE, name: "Maria", service: "Teeth Whitening", start: at(local), origin: "panel", conversationId: null, ...over });

test("marca: evento com nome e serviço, agendamento com telefone e origem, cliente no cadastro", async () => {
  const result = await slot();
  assert.equal(result.kind, "booked");
  const [event] = [...fake.events.values()];
  assert.equal(event.summary, "Maria — Teeth Whitening");
  assert.match(event.description, /^WhatsApp: \+5571999999999\nServiço: Teeth Whitening\nMarcado pelo Secretaryfy \(painel\)\.$/);
  const [appt] = await testDb.db.select().from(appointments);
  assert.deepEqual(
    [appt.phone, appt.origin, appt.conversationId, appt.reminderStatus, appt.service],
    [PHONE, "panel", null, "pending", "Teeth Whitening"],
  );
  const customer = await customers.findByPhone(PHONE);
  assert.equal(appt.customerId, customer?.id);
});

test("com conversa: registro no histórico; pelo assistente, a descrição não diz painel", async () => {
  const conv = await repo.upsertConversation({ phone: PHONE, name: ".", at: NOW, preview: "Oi" });
  await slot("2026-10-22T10:00", { origin: "assistant", conversationId: conv.id });
  assert.match([...fake.events.values()][0].description, /Marcado pelo Secretaryfy\.$/);
  const notes = (await testDb.db.select().from(messages)).map((m) => m.text);
  assert.deepEqual(notes, ["Booked by the assistant: Thu, Oct 22 at 10:00 AM (60 min), Teeth Whitening"]);
});

test("um horário futuro por telefone: already_booked com o horário atual", async () => {
  await slot();
  const again = await slot("2026-10-23T10:00");
  assert.equal(again.kind, "already_booked");
  assert.equal(again.kind === "already_booked" && again.appointment.startsAt.getTime(), at("2026-10-22T10:00").getTime());
  assert.equal(fake.events.size, 1);
});

test("horário ocupado no Google, fora das regras ou tomado no meio-tempo: slot_taken, sem evento sobrando", async () => {
  fake.block(at("2026-10-22T10:00"), at("2026-10-22T11:00"));
  assert.equal((await slot()).kind, "slot_taken");
  // Sábado
  assert.equal((await slot("2026-10-24T10:00")).kind, "slot_taken");

  // Outro telefone ficou com o horário no banco, mas o evento dele sumiu do Google: o índice único recusa e desfaz
  await slot("2026-10-23T10:00", { phone: "5571988887777" });
  fake.events.clear();
  assert.equal((await slot("2026-10-23T10:00")).kind, "slot_taken");
  assert.equal(fake.events.size, 0);
});

test("agenda desconectada: calendar_unavailable, nada criado", async () => {
  conn = { ...conn!, status: "needs_reauth" };
  assert.equal((await slot()).kind, "calendar_unavailable");
  conn = null;
  assert.equal((await slot()).kind, "calendar_unavailable");
  assert.equal(fake.calls.createEvent, 0);
});

test("a chave guardada sai como o título do tratamento no evento, na nota e na descrição", async () => {
  booking = engine(createCatalog([{ name: "limpeza-dental", label: "Limpeza dental" }]));
  const conv = await repo.upsertConversation({ phone: PHONE, name: ".", at: NOW, preview: "Oi" });
  const result = await slot("2026-10-22T10:00", { service: "limpeza-dental", origin: "assistant", conversationId: conv.id });
  assert.equal(result.kind, "booked");
  const [event] = [...fake.events.values()];
  assert.equal(event.summary, "Maria — Limpeza dental");
  assert.match(event.description, /Serviço: Limpeza dental\n/);
  const [appt] = await testDb.db.select().from(appointments);
  assert.equal(appt.service, "limpeza-dental");
  const notes = (await testDb.db.select().from(messages)).map((m) => m.text);
  assert.deepEqual(notes, ["Booked by the assistant: Thu, Oct 22 at 10:00 AM (60 min), Limpeza dental"]);
});

test("um nome que não está no catálogo vai para o evento como está", async () => {
  booking = engine(createCatalog([{ name: "limpeza-dental", label: "Limpeza dental" }]));
  await slot("2026-10-22T10:00");
  assert.equal([...fake.events.values()][0].summary, "Maria — Teeth Whitening");
});

test("a equipe marca até um ano à frente; o assistente segue a janela de 30 dias, e nem a equipe passa de um ano", async () => {
  // 2027-01-28 é 100 dias depois de hoje; 2027-10-20 é o dia 365; 2027-10-21 é o dia 366
  assert.equal((await slot("2027-01-28T10:00")).kind, "booked");
  assert.equal((await slot("2027-01-28T11:00", { phone: "5571988887777", origin: "assistant" })).kind, "slot_taken");
  assert.equal((await slot("2027-10-20T10:00", { phone: "5571977776666" })).kind, "booked");
  assert.equal((await slot("2027-10-21T10:00", { phone: "5571966665555" })).kind, "slot_taken");
  assert.equal(fake.events.size, 2);
});

test("menos de 24 h de antecedência: lembrete não necessário", async () => {
  await slot("2026-10-21T10:00");
  const [appt] = await testDb.db.select().from(appointments);
  assert.equal(appt.reminderStatus, "not_needed");
});

// --- Duração escolhida pela equipe (painel) ---

test("painel com minutes: a duração vale para o evento, o fim do agendamento e a nota", async () => {
  const conv = await repo.upsertConversation({ phone: PHONE, name: ".", at: NOW, preview: "Oi" });
  const result = await slot("2026-10-22T10:00", { minutes: 20, conversationId: conv.id });
  assert.equal(result.kind, "booked");
  const [event] = [...fake.events.values()];
  assert.equal(event.end.getTime(), at("2026-10-22T10:20").getTime());
  const [appt] = await testDb.db.select().from(appointments);
  assert.equal(appt.endsAt.getTime(), at("2026-10-22T10:20").getTime());
  const notes = (await testDb.db.select().from(messages)).map((m) => m.text);
  assert.deepEqual(notes, ["Booked from the panel: Thu, Oct 22 at 10:00 AM (20 min), Teeth Whitening"]);
});

test("painel com minutes além da folga até a próxima ocupação: slot_taken; dentro dela: booked", async () => {
  fake.block(at("2026-10-22T10:30"), at("2026-10-22T11:00"));
  assert.equal((await slot("2026-10-22T10:00", { minutes: 45 })).kind, "slot_taken");
  assert.equal(fake.events.size, 0);
  assert.equal((await slot("2026-10-22T10:00", { minutes: 30 })).kind, "booked");
});

test("o assistente ignora minutes: sempre a duração do tratamento", async () => {
  const result = await slot("2026-10-22T10:00", { origin: "assistant", minutes: 20 });
  assert.equal(result.kind, "booked");
  const [appt] = await testDb.db.select().from(appointments);
  assert.equal(appt.endsAt.getTime(), at("2026-10-22T11:00").getTime());
});

// --- Cancelar (cancelAppointment) ---

test("cancelamento: apaga o evento e grava quem cancelou; com conversa, registra a nota certa", async () => {
  const conv = await repo.upsertConversation({ phone: PHONE, name: ".", at: NOW, preview: "Oi" });
  const booked = await slot("2026-10-22T10:00", { conversationId: conv.id });
  assert.equal(booked.kind, "booked");
  const id = booked.kind === "booked" ? booked.appointment.id : "";

  const result = await booking.cancelAppointment({ id, by: "staff", conversationId: conv.id });
  assert.equal(result.kind, "cancelled");
  assert.equal(fake.events.size, 0);
  assert.equal(fake.calls.deleteEvent, 1);
  const [appt] = await testDb.db.select().from(appointments);
  assert.deepEqual([appt.status, appt.cancelledBy], ["cancelled", "staff"]);
  const notes = (await testDb.db.select().from(messages)).map((m) => m.text);
  assert.deepEqual(notes.at(-1), "Cancelled from the panel: Thu, Oct 22 at 10:00 AM");
});

test("cancelamento pelo cliente: a nota é a de cliente; sem conversa, nenhuma nota", async () => {
  const conv = await repo.upsertConversation({ phone: PHONE, name: ".", at: NOW, preview: "Oi" });
  const booked = await slot("2026-10-22T10:00", { conversationId: conv.id });
  const id = booked.kind === "booked" ? booked.appointment.id : "";
  assert.equal((await booking.cancelAppointment({ id, by: "customer", conversationId: conv.id })).kind, "cancelled");
  const notes = (await testDb.db.select().from(messages)).map((m) => m.text);
  assert.equal(notes.at(-1), "Cancelled by the customer: Thu, Oct 22 at 10:00 AM");

  const other = await slot("2026-10-23T10:00", { phone: "5571988887777" });
  const otherId = other.kind === "booked" ? other.appointment.id : "";
  const before = (await testDb.db.select().from(messages)).length;
  assert.equal((await booking.cancelAppointment({ id: otherId, by: "staff", conversationId: null })).kind, "cancelled");
  assert.equal((await testDb.db.select().from(messages)).length, before);
});

test("cancelamento: não encontrado para horário já passado, já cancelado, inexistente ou que não é mais agendado", async () => {
  const booked = await slot("2026-10-22T10:00");
  const id = booked.kind === "booked" ? booked.appointment.id : "";
  // Depois do horário: o motor vê o horário como passado
  const late = engine(testCatalog, at("2026-10-22T10:30"));
  assert.deepEqual(await late.cancelAppointment({ id, by: "staff", conversationId: null }), { kind: "not_found" });
  assert.equal(fake.events.size, 1);

  assert.equal((await booking.cancelAppointment({ id, by: "staff", conversationId: null })).kind, "cancelled");
  assert.deepEqual(await booking.cancelAppointment({ id, by: "staff", conversationId: null }), { kind: "not_found" });
  const unknown = "00000000-0000-4000-8000-000000000000";
  assert.deepEqual(await booking.cancelAppointment({ id: unknown, by: "staff", conversationId: null }), { kind: "not_found" });
});

test("cancelamento com a agenda desconectada: calendar_unavailable, nada apagado", async () => {
  const booked = await slot("2026-10-22T10:00");
  const id = booked.kind === "booked" ? booked.appointment.id : "";
  conn = { ...conn!, status: "needs_reauth" };
  assert.deepEqual(await booking.cancelAppointment({ id, by: "staff", conversationId: null }), { kind: "calendar_unavailable" });
  conn = null;
  assert.deepEqual(await booking.cancelAppointment({ id, by: "staff", conversationId: null }), { kind: "calendar_unavailable" });
  assert.equal(fake.calls.deleteEvent, 0);
  assert.equal(fake.events.size, 1);
});

test("evento apagado no Google antes do cancelamento: not_found, o horário fica cancelado pelo calendário e registra a nota", async () => {
  const conv = await repo.upsertConversation({ phone: PHONE, name: ".", at: NOW, preview: "Oi" });
  const booked = await slot("2026-10-22T10:00", { conversationId: conv.id });
  const id = booked.kind === "booked" ? booked.appointment.id : "";
  fake.events.clear();

  assert.deepEqual(await booking.cancelAppointment({ id, by: "staff", conversationId: conv.id }), { kind: "not_found" });
  const [appt] = await testDb.db.select().from(appointments);
  assert.deepEqual([appt.status, appt.cancelledBy], ["cancelled", "calendar"]);
  const notes = (await testDb.db.select().from(messages)).map((m) => m.text);
  assert.equal(notes.at(-1), "Cancelled in the calendar: Thu, Oct 22 at 10:00 AM");
});
