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
import { createBooking, type Booking } from "./booking.js";
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

beforeEach(async () => {
  await testDb.db.execute(sql`truncate table scheduling_sessions, appointments, customers, messages, conversations cascade`);
  conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" };
  fake = createFakeCalendar();
  booking = createBooking({
    calendar: fake.gateway,
    connection: { getForUse: async () => conn },
    rules: { get: async () => ({ ...DEFAULT_RULES }) },
    store,
    inbox: createInboxService({ repo, publish: () => {}, now: () => NOW.getTime() }),
    customers,
    log: { error: () => {} },
    now: () => NOW,
  });
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
  assert.deepEqual(notes, ["📅 Booked by the assistant: Thu, Oct 22 at 10:00 AM (60 min) — Teeth Whitening"]);
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

test("menos de 24 h de antecedência: lembrete não necessário", async () => {
  await slot("2026-10-21T10:00");
  const [appt] = await testDb.db.select().from(appointments);
  assert.equal(appt.reminderStatus, "not_needed");
});
