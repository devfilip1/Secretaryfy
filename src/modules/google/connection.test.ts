import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { calendarConnection, conversations, schedulingSessions } from "../../db/schema.js";
import { createTestDb } from "../../test/db.js";
import type { InboxEvent } from "../inbox/events.js";
import { createConnectionStore, type ConnectionStore } from "./connection.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let store: ConnectionStore;
let events: InboxEvent[];

const calendar = { id: "primary", name: "DentalSafe", timeZone: "America/Bahia" };

before(async () => {
  testDb = await createTestDb();
});
after(() => testDb.close());
beforeEach(async () => {
  await testDb.db.execute(sql`delete from scheduling_sessions`);
  await testDb.db.execute(sql`delete from conversations`);
  await testDb.db.execute(sql`delete from calendar_connection`);
  events = [];
  store = createConnectionStore({ db: testDb.db as never, publish: (e) => events.push(e) });
});

test("sem linha, a agenda está desconectada", async () => {
  assert.deepEqual(await store.get(), {
    status: "disconnected",
    email: null,
    calendarId: null,
    calendarName: null,
    timeZone: null,
  });
  assert.equal(await store.getForUse(), null);
});

test("save grava o token criptografado e publica calendar.updated", async () => {
  await store.save({ email: "clinica@gmail.com", refreshToken: "1//segredo", scopes: "a b", calendar });

  const [row] = await testDb.db.select().from(calendarConnection);
  assert.notEqual(row.refreshTokenEnc, "1//segredo");
  assert.ok(!row.refreshTokenEnc.includes("segredo"));
  assert.deepEqual(await store.get(), {
    status: "connected",
    email: "clinica@gmail.com",
    calendarId: "primary",
    calendarName: "DentalSafe",
    timeZone: "America/Bahia",
  });
  assert.equal((await store.getForUse())?.refreshToken, "1//segredo");
  assert.deepEqual(events.map((e) => e.type), ["calendar.updated"]);
});

test("reconectar substitui a conexão e volta a connected", async () => {
  await store.save({ email: "a@gmail.com", refreshToken: "t1", scopes: "", calendar });
  await store.markNeedsReauth();
  await store.save({ email: "b@gmail.com", refreshToken: "t2", scopes: "", calendar });
  const current = await store.get();
  assert.equal(current.status, "connected");
  assert.equal(current.email, "b@gmail.com");
  assert.equal((await store.getForUse())?.refreshToken, "t2");
});

test("selectCalendar troca a agenda e markNeedsReauth muda o status, publicando cada mudança", async () => {
  await store.save({ email: "clinica@gmail.com", refreshToken: "t", scopes: "", calendar });
  await store.selectCalendar({ id: "abc@group.calendar.google.com", name: "Teste", timeZone: "America/Sao_Paulo" });
  assert.equal((await store.get()).calendarId, "abc@group.calendar.google.com");
  await store.markNeedsReauth();
  assert.equal((await store.get()).status, "needs_reauth");
  // Repetir não publica de novo
  await store.markNeedsReauth();
  assert.equal(events.length, 3);
});

test("syncCalendar corrige o fuso e o nome da agenda escolhida quando mudam no Google", async () => {
  await store.save({ email: "clinica@gmail.com", refreshToken: "t", scopes: "", calendar: { ...calendar, timeZone: "UTC" } });
  events = [];

  assert.equal(await store.syncCalendar([{ id: "outra", name: "X", timeZone: "UTC" }]), false);
  assert.equal(await store.syncCalendar([{ id: "primary", name: "DentalSafe", timeZone: "America/Bahia" }]), true);
  assert.equal((await store.get()).timeZone, "America/Bahia");
  assert.deepEqual(events.map((e) => e.type), ["calendar.updated"]);
  // Igual ao Google: nada muda
  assert.equal(await store.syncCalendar([{ id: "primary", name: "DentalSafe", timeZone: "America/Bahia" }]), false);
});

test("remove apaga a conexão e as sessões de agendamento, e devolve o token para revogar", async () => {
  await store.save({ email: "clinica@gmail.com", refreshToken: "t", scopes: "", calendar });
  const [conv] = await testDb.db
    .insert(conversations)
    .values({ phone: "5511999999999", lastMessageAt: new Date(), lastMessagePreview: "Oi" })
    .returning();
  await testDb.db
    .insert(schedulingSessions)
    .values({ conversationId: conv.id, flow: "book", step: "choose_day", expiresAt: new Date(Date.now() + 60_000) });

  assert.equal(await store.remove(), "t");
  assert.equal((await store.get()).status, "disconnected");
  assert.equal((await testDb.db.select().from(schedulingSessions)).length, 0);
  assert.equal(await store.remove(), null);
});
