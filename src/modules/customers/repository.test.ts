import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { appointments, conversations } from "../../db/schema.js";
import { createTestDb } from "../../test/db.js";
import { createCustomerRepository, type CustomerRepository } from "./repository.js";

let close: () => Promise<unknown>;
let repo: CustomerRepository;
let reset: () => Promise<unknown>;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];

before(async () => {
  const testDb = await createTestDb();
  close = testDb.close;
  db = testDb.db;
  repo = createCustomerRepository(testDb.db as never);
  reset = async () => {
    await testDb.db.execute(sql`delete from appointments`);
    await testDb.db.execute(sql`delete from conversations`);
    await testDb.db.execute(sql`delete from customers`);
  };
});
after(() => close());
beforeEach(() => reset());

const at = (min: number) => new Date(Date.UTC(2026, 9, 25, 13, min));

test("número novo entra no cadastro com id, nome e telefone", async () => {
  const row = await repo.upsert({ phone: "5511999999999", name: "Maria", at: at(0) });
  assert.match(row.id, /^[0-9a-f-]{36}$/);
  assert.equal(row.name, "Maria");
  assert.deepEqual(await repo.findByPhone("5511999999999"), row);
});

test("o mesmo número não gera outro registro e fica com o nome mais recente", async () => {
  const first = await repo.upsert({ phone: "5511999999999", name: "Maria", at: at(0) });
  const second = await repo.upsert({ phone: "5511999999999", name: "Maria Souza", at: at(5) });
  assert.equal(second.id, first.id);
  assert.equal(second.name, "Maria Souza");
  assert.deepEqual(second.updatedAt, at(5));
  assert.deepEqual(second.createdAt, first.createdAt);
});

test("número desconhecido: null", async () => {
  assert.equal(await repo.findByPhone("5511000000000"), null);
});

test("dois agendamentos simultâneos do mesmo número deixam um registro só", async () => {
  const [a, b] = await Promise.all([
    repo.upsert({ phone: "5511999999999", name: "Maria", at: at(0) }),
    repo.upsert({ phone: "5511999999999", name: "Maria", at: at(0) }),
  ]);
  assert.equal(a.id, b.id);
});

test("list: clientes por nome, cada um com os próprios agendamentos, mais recentes primeiro", async () => {
  const bia = await repo.upsert({ phone: "5511911111111", name: "Bia", at: at(0) });
  const ana = await repo.upsert({ phone: "5511922222222", name: "Ana", at: at(1) });
  const [conv] = await db.insert(conversations).values({ phone: bia.phone, name: "Bia", lastMessageAt: at(0), lastMessagePreview: "" }).returning();
  const booking = (min: number, status: "booked" | "cancelled", service: string | null) => ({
    conversationId: conv.id,
    phone: bia.phone,
    googleEventId: `ev-${min}`,
    calendarId: "primary",
    startsAt: at(min),
    endsAt: at(min + 30),
    customerName: "Bia",
    service,
    status,
    customerId: bia.id,
  });
  await db.insert(appointments).values([booking(10, "cancelled", "Dental Cleaning"), booking(40, "booked", null)]);

  const list = await repo.list();
  assert.deepEqual(
    list.map((c) => c.name),
    ["Ana", "Bia"],
  );
  assert.deepEqual(list[0].appointments, []);
  assert.equal(list[0].id, ana.id);
  assert.deepEqual(list[1].appointments, [
    { startsAt: at(40), service: null, status: "booked" },
    { startsAt: at(10), service: "Dental Cleaning", status: "cancelled" },
  ]);
});

test("remove: apaga o cadastro e mantém os agendamentos sem o vínculo", async () => {
  const bia = await repo.upsert({ phone: "5511911111111", name: "Bia", at: at(0) });
  const [conv] = await db.insert(conversations).values({ phone: bia.phone, name: "Bia", lastMessageAt: at(0), lastMessagePreview: "" }).returning();
  await db.insert(appointments).values({
    conversationId: conv.id,
    phone: bia.phone,
    googleEventId: "ev-1",
    calendarId: "primary",
    startsAt: at(10),
    endsAt: at(40),
    customerName: "Bia",
    customerId: bia.id,
  });

  assert.equal((await repo.remove(bia.id))?.phone, bia.phone);
  assert.equal(await repo.findByPhone(bia.phone), null);
  const [kept] = await db.select().from(appointments);
  assert.equal(kept.customerId, null);
  assert.equal(await repo.remove(bia.id), null);
});

test("update: só o campo pedido muda; notes null apaga; id desconhecido devolve null", async () => {
  const maria = await repo.upsert({ phone: "5511999999999", name: "Maria", at: at(0) });
  const named = await repo.update(maria.id, { name: "Maria Souza" }, at(1));
  assert.deepEqual([named?.name, named?.notes, named?.updatedAt], ["Maria Souza", null, at(1)]);
  const noted = await repo.update(maria.id, { notes: "allergic to latex" }, at(2));
  assert.deepEqual([noted?.name, noted?.notes], ["Maria Souza", "allergic to latex"]);
  assert.equal((await repo.update(maria.id, { notes: null }, at(3)))?.notes, null);
  assert.equal((await repo.findById(maria.id))?.name, "Maria Souza");
  assert.equal(await repo.update("00000000-0000-4000-8000-000000000000", { name: "X" }, at(4)), null);
  assert.equal(await repo.findById("00000000-0000-4000-8000-000000000000"), null);
});

test("list traz as anotações", async () => {
  const maria = await repo.upsert({ phone: "5511999999999", name: "Maria", at: at(0) });
  await repo.update(maria.id, { notes: "prefers mornings" }, at(1));
  assert.equal((await repo.list())[0].notes, "prefers mornings");
});
