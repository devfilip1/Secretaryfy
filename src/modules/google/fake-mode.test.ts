import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { createTestDb } from "../../test/db.js";
import { createFakeCalendar as createFromTestPath } from "../../test/fake-calendar.js";
import { createConnectionStore, type ConnectionStore } from "./connection.js";
import { createFakeCalendar } from "./fake-calendar.js";
import { calendarModeRefusal, prepareFakeCalendar } from "./fake-mode.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let store: ConnectionStore;
let published: string[];

before(async () => {
  testDb = await createTestDb();
});
after(() => testDb.close());
beforeEach(async () => {
  await testDb.db.execute(sql`delete from calendar_connection`);
  published = [];
  store = createConnectionStore({ db: testDb.db as never, publish: (e) => published.push(e.type) });
});

test("prepareFakeCalendar deixa a agenda conectada à falsa e é idempotente", async () => {
  const calendars = createFakeCalendar().gateway;
  const deps = { connection: store, calendars: await calendars.listCalendars(), countAppointments: async () => 0 };

  assert.equal((await store.get()).status, "disconnected");
  assert.equal((await prepareFakeCalendar(deps)).seeded, true);

  const connected = await store.get();
  assert.equal(connected.status, "connected");
  assert.equal(connected.email, "agenda-falsa@localhost");
  assert.equal(connected.calendarId, "primary");
  assert.equal(connected.timeZone, "America/Bahia");

  // Segunda chamada: nada a gravar, nada publicado
  assert.equal((await prepareFakeCalendar(deps)).seeded, false);
  assert.deepEqual(published, ["calendar.updated"]);
});

test("prepareFakeCalendar informa quantos agendamentos já existiam no banco", async () => {
  const { gateway } = createFakeCalendar();
  const result = await prepareFakeCalendar({ connection: store, calendars: await gateway.listCalendars(), countAppointments: async () => 3 });
  assert.equal(result.storedAppointments, 3);
});

test("calendarModeRefusal recusa o modo falso em produção e aceita os demais casos", () => {
  assert.notEqual(calendarModeRefusal("fake", "production"), null);
  assert.equal(calendarModeRefusal("fake", "development"), null);
  assert.equal(calendarModeRefusal("fake", undefined), null);
  assert.equal(calendarModeRefusal("google", "production"), null);
});

test("o re-export em src/test/fake-calendar.ts é a mesma implementação", async () => {
  assert.equal(createFromTestPath, createFakeCalendar);
  const { gateway } = createFromTestPath();
  assert.equal((await gateway.listCalendars())[0].id, "primary");
});
