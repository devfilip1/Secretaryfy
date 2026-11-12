import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { clinicSettings } from "../../db/schema.js";
import { createTestDb } from "../../test/db.js";
import { createClinicSettingsRepository, type ClinicSettingsRepository } from "./settings-repository.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let repo: ClinicSettingsRepository;

/** Os campos de agendamento de uma linha gravada sem eles. */
const DEFAULTS = { offerAssessment: true, offerFollowUp: false, assessmentMinutes: null, followUpMinutes: null };

before(async () => {
  testDb = await createTestDb();
  repo = createClinicSettingsRepository(testDb.db as never);
});

after(() => testDb.close());

beforeEach(async () => {
  await testDb.db.execute(sql`delete from clinic_settings`);
});

test("get devolve null antes da primeira gravação, e depois a identidade gravada", async () => {
  assert.equal(await repo.get(), null);
  await repo.save({ name: "Sorriso Pleno", assistantName: "Ana", kind: "dental clinic" });
  assert.deepEqual(await repo.get(), { ...DEFAULTS, name: "Sorriso Pleno", assistantName: "Ana", kind: "dental clinic", language: undefined });
});

test("sem nome da atendente, guarda null e devolve undefined", async () => {
  await repo.save({ name: "DentalSafe", kind: "dental clinic" });
  assert.deepEqual(await repo.get(), { ...DEFAULTS, name: "DentalSafe", assistantName: undefined, kind: "dental clinic", language: undefined });
});

test("grava e lê a língua; com a coluna vazia, devolve undefined", async () => {
  await repo.save({ name: "DentalSafe", kind: "dental clinic", language: "pt" });
  assert.equal((await repo.get())?.language, "pt");
  await testDb.db.execute(sql`update clinic_settings set language = null`);
  assert.equal((await repo.get())?.language, undefined);
});

test("gravar de novo troca a linha: a tabela continua com uma linha só", async () => {
  await repo.save({ name: "DentalSafe", kind: "dental clinic" });
  await repo.save({ name: "Smile Clinic", assistantName: "Bia", kind: "physiotherapy clinic" });
  assert.equal((await testDb.db.select().from(clinicSettings)).length, 1);
  assert.deepEqual(await repo.get(), { ...DEFAULTS, name: "Smile Clinic", assistantName: "Bia", kind: "physiotherapy clinic", language: undefined });
});

test("grava e lê os campos de agendamento; a linha nova começa com os padrões", async () => {
  await repo.save({ name: "DentalSafe", kind: "dental clinic", offerAssessment: false, offerFollowUp: true, assessmentMinutes: 30, followUpMinutes: 240 });
  assert.deepEqual(await repo.get(), { name: "DentalSafe", assistantName: undefined, kind: "dental clinic", language: undefined, offerAssessment: false, offerFollowUp: true, assessmentMinutes: 30, followUpMinutes: 240 });
  await repo.save({ name: "DentalSafe", kind: "dental clinic" });
  assert.deepEqual(await repo.get(), { name: "DentalSafe", assistantName: undefined, kind: "dental clinic", language: undefined, ...DEFAULTS });
});

test("o banco recusa minutos fora de 15–240 de 5 em 5", async () => {
  for (const minutes of [10, 245, 17]) {
    await assert.rejects(testDb.db.execute(sql`insert into clinic_settings (id, name, kind, assessment_minutes) values (1, 'x', 'y', ${minutes})`), undefined, String(minutes));
    await assert.rejects(testDb.db.execute(sql`insert into clinic_settings (id, name, kind, follow_up_minutes) values (1, 'x', 'y', ${minutes})`), undefined, String(minutes));
  }
});

test("o banco recusa uma segunda linha (id = 1)", async () => {
  await assert.rejects(testDb.db.execute(sql`insert into clinic_settings (id, name, kind) values (2, 'x', 'y')`));
});
