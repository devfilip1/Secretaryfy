import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createTestDb } from "../../test/db.js";
import { parseBrochure } from "./import-markdown.js";
import { createKnowledgeRepository, KnowledgeOrderError, type KnowledgeRepository } from "./repository.js";
import { toSections } from "./render.js";
import type { KnowledgeRow } from "./types.js";

const BROCHURE = "## Limpeza Dental — O primeiro passo\nComo funciona: Ultrassom.\nDuração: 30 min   |   Preço: R$ 40\nResultado: Imediato\n\n## Sobre nós\nLinha um\n";

const info = (key: string, position: number): KnowledgeRow => ({
  key,
  kind: "info",
  title: key,
  tagline: null,
  data: { lines: ["Linha"] },
  position,
});

let close: () => Promise<unknown>;
let repo: KnowledgeRepository;

before(async () => {
  const testDb = await createTestDb();
  close = testDb.close;
  repo = createKnowledgeRepository(testDb.db as never);
});

beforeEach(async () => {
  await repo.replaceAll([]);
});

after(async () => {
  await close();
});

test("list is empty before any import", async () => {
  assert.deepEqual(await repo.list(), []);
});

test("replaceAll stores the rows and list gives them back in position order", async () => {
  const rows = parseBrochure(BROCHURE);
  await repo.replaceAll(rows);
  assert.deepEqual(toSections(await repo.list(), "pt"), toSections(rows, "pt"));
  assert.deepEqual((await repo.list()).map((row) => row.key), rows.map((row) => row.key));
});

test("replaceAll twice keeps only the second content (idempotent import)", async () => {
  await repo.replaceAll(parseBrochure(BROCHURE));
  const second = parseBrochure("## Só esta\nLinha\n");
  await repo.replaceAll(second);
  await repo.replaceAll(second);
  assert.deepEqual(toSections(await repo.list(), "pt"), toSections(second, "pt"));
});

test("get returns the row with that key, or null", async () => {
  await repo.replaceAll([info("a", 0)]);
  assert.equal((await repo.get("a"))?.title, "a");
  assert.equal(await repo.get("missing"), null);
});

test("upsert adds a new key and, with a key already stored, replaces that row", async () => {
  await repo.replaceAll([info("a", 0)]);
  await repo.upsert({ ...info("a", 0), title: "Mudou" });
  await repo.upsert(info("b", 1));
  assert.deepEqual((await repo.list()).map((row) => [row.key, row.title]), [
    ["a", "Mudou"],
    ["b", "b"],
  ]);
});

test("upsert refuses a row that does not pass the schema", async () => {
  await assert.rejects(repo.upsert({ ...info("a", 0), title: "" }));
  assert.deepEqual(await repo.list(), []);
});

test("remove deletes by key and says whether the key was there", async () => {
  await repo.replaceAll([info("a", 0), info("b", 1)]);
  assert.equal(await repo.remove("a"), true);
  assert.equal(await repo.remove("a"), false);
  assert.deepEqual((await repo.list()).map((row) => row.key), ["b"]);
});

test("reorder rewrites the positions in the given order", async () => {
  await repo.replaceAll([info("a", 0), info("b", 1), info("c", 2)]);
  await repo.reorder(["c", "a", "b"]);
  assert.deepEqual((await repo.list()).map((row) => [row.key, row.position]), [
    ["c", 0],
    ["a", 1],
    ["b", 2],
  ]);
});

test("reorder refuses unknown, missing or repeated keys, and changes nothing", async () => {
  await repo.replaceAll([info("a", 0), info("b", 1)]);
  for (const keys of [["a", "x"], ["a"], ["a", "a"]]) {
    await assert.rejects(repo.reorder(keys), KnowledgeOrderError);
  }
  assert.deepEqual((await repo.list()).map((row) => [row.key, row.position]), [
    ["a", 0],
    ["b", 1],
  ]);
});
