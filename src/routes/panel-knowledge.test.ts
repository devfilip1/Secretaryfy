import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { parseBrochure } from "../modules/knowledge/import-markdown.js";
import { toDocument } from "../modules/knowledge/render.js";
import { createKnowledgeRepository, type KnowledgeRepository } from "../modules/knowledge/repository.js";
import { RagUnavailableError } from "../modules/rag/client.js";
import { RagAlreadyIndexingError } from "../modules/rag/admin.js";
import { createTestDb } from "../test/db.js";
import { panelKnowledgeRoutes } from "./panel-knowledge.js";

const CLINIC = "Sorriso Pleno";
const BROCHURE = "## Limpeza Dental — O primeiro passo\nComo funciona: Ultrassom.\nDuração: 30 min   |   Preço: R$ 40\nResultado: Imediato\n\n## Sobre nós\nLinha um\n";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let repo: KnowledgeRepository;
let app: FastifyInstance;

/** RAG falso: guarda a versão indexada e pode fingir estar fora do ar ou ocupado. */
const rag = {
  indexedVersion: null as string | null,
  down: false,
  busy: false,
  async status() {
    if (rag.down) throw new RagUnavailableError("rag unavailable");
    return { state: rag.indexedVersion === null ? "missing" : "current", indexedVersion: rag.indexedVersion };
  },
  async reindex() {
    if (rag.down) throw new RagUnavailableError("rag unavailable");
    if (rag.busy) throw new RagAlreadyIndexingError();
    const version = toDocument(CLINIC, await repo.list(), "pt").version;
    rag.indexedVersion = version;
    return { chunks: { lex: 3 }, version };
  },
};

before(async () => {
  testDb = await createTestDb();
  repo = createKnowledgeRepository(testDb.db as never);
});

after(() => testDb.close());

beforeEach(async () => {
  await repo.replaceAll(parseBrochure(BROCHURE));
  rag.indexedVersion = null;
  rag.down = false;
  rag.busy = false;
  app = Fastify();
  await app.register(panelKnowledgeRoutes({ repo, rag, clinicName: CLINIC, language: "pt" }));
  await app.ready();
});

const keys = async () => (await repo.list()).map((row) => row.key);
const treatmentData = {
  howItWorks: { label: "Como funciona", value: "Ultrassom." },
  facts: [{ label: "Preço", value: "R$ 50" }],
  result: { label: "Resultado", value: "Imediato" },
};
const infoSection = { kind: "info", title: "Horários", tagline: null, data: { lines: ["Seg a sex"] } };

test("GET /api/knowledge brings the field labels in the clinic language", async () => {
  const json = (await app.inject({ url: "/api/knowledge" })).json();
  assert.equal(json.labels.howItWorks, "Como funciona");
  assert.equal(json.labels.price, "Preço");
  assert.equal(json.labels.assessment, "(valor final definido na avaliação)");
});

test("GET /api/knowledge lists the sections in position order", async () => {
  const res = await app.inject({ url: "/api/knowledge" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().sections.map((s: { key: string }) => s.key), ["limpeza-dental", "sobre-nos"]);
});

test("POST creates a section at the end, with a key from the title and a suffix when it is taken", async () => {
  const res = await app.inject({ method: "POST", url: "/api/knowledge", payload: { ...infoSection, title: "Sobre nós" } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().section.key, "sobre-nos-2");
  assert.equal(res.json().section.position, 2);
  assert.deepEqual(await keys(), ["limpeza-dental", "sobre-nos", "sobre-nos-2"]);
});

test("POST never gives a section the key order, which the reorder route owns", async () => {
  const res = await app.inject({ method: "POST", url: "/api/knowledge", payload: { ...infoSection, title: "Order" } });
  assert.equal(res.json().section.key, "order-2");
});

test("POST with data that does not match the kind is 400 with a message", async () => {
  const res = await app.inject({ method: "POST", url: "/api/knowledge", payload: { ...infoSection, data: { facts: [] } } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_body");
  assert.equal(typeof res.json().message, "string");
  assert.ok(res.json().fields.every((f: { path: string; message: string }) => typeof f.path === "string" && typeof f.message === "string"));
  assert.equal((await repo.list()).length, 2);
});

test("PUT replaces title, tagline and data, and keeps the key and the position", async () => {
  const res = await app.inject({
    method: "PUT",
    url: "/api/knowledge/limpeza-dental",
    payload: { title: "Limpeza", tagline: "Novo slogan", data: treatmentData },
  });
  assert.equal(res.statusCode, 200);
  const [first] = await repo.list();
  assert.deepEqual([first.key, first.position, first.title, first.tagline], ["limpeza-dental", 0, "Limpeza", "Novo slogan"]);
  assert.deepEqual(first.kind === "treatment" && first.data.facts, [{ label: "Preço", value: "R$ 50" }]);
});

test("PUT with data for the other kind is 400; an unknown key is 404 and the body is not checked", async () => {
  const wrongKind = await app.inject({
    method: "PUT",
    url: "/api/knowledge/sobre-nos",
    payload: { title: "Sobre nós", tagline: null, data: treatmentData },
  });
  assert.equal(wrongKind.statusCode, 400);
  const unknown = await app.inject({ method: "PUT", url: "/api/knowledge/nao-existe", payload: { title: "X", tagline: null, data: { lines: ["a"] } } });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error, "not_found");
});

test("DELETE removes a section (204); an unknown key is 404", async () => {
  assert.equal((await app.inject({ method: "DELETE", url: "/api/knowledge/sobre-nos" })).statusCode, 204);
  assert.deepEqual(await keys(), ["limpeza-dental"]);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/knowledge/sobre-nos" })).statusCode, 404);
});

test("PUT /api/knowledge/order rewrites the order (204)", async () => {
  const res = await app.inject({ method: "PUT", url: "/api/knowledge/order", payload: { keys: ["sobre-nos", "limpeza-dental"] } });
  assert.equal(res.statusCode, 204);
  assert.deepEqual(await keys(), ["sobre-nos", "limpeza-dental"]);
});

test("PUT /api/knowledge/order with unknown, missing or malformed keys is 400 and changes nothing", async () => {
  for (const payload of [{ keys: ["sobre-nos", "x"] }, { keys: ["sobre-nos"] }, { keys: "sobre-nos" }]) {
    const res = await app.inject({ method: "PUT", url: "/api/knowledge/order", payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.equal(typeof res.json().message, "string");
  }
  assert.deepEqual(await keys(), ["limpeza-dental", "sobre-nos"]);
});

test("GET /api/knowledge/status: unpublished before a publish, with the RAG's version", async () => {
  const res = await app.inject({ url: "/api/knowledge/status" });
  assert.equal(res.statusCode, 200);
  const version = toDocument(CLINIC, await repo.list(), "pt").version;
  assert.deepEqual(res.json(), { version, indexedVersion: null, state: "unpublished" });
});

test("GET /api/knowledge/status: unavailable when the RAG does not answer", async () => {
  rag.down = true;
  const res = await app.inject({ url: "/api/knowledge/status" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().state, "unavailable");
  assert.equal(res.json().indexedVersion, null);
});

test("POST /api/knowledge/publish reindexes and answers upToDate with the new version", async () => {
  const res = await app.inject({ method: "POST", url: "/api/knowledge/publish" });
  assert.equal(res.statusCode, 200);
  const version = toDocument(CLINIC, await repo.list(), "pt").version;
  assert.deepEqual(res.json(), { version, indexedVersion: version, state: "upToDate" });
  assert.deepEqual((await app.inject({ url: "/api/knowledge/status" })).json().state, "upToDate");
});

test("an edit after a publish makes the status unpublished again", async () => {
  await app.inject({ method: "POST", url: "/api/knowledge/publish" });
  await app.inject({ method: "PUT", url: "/api/knowledge/sobre-nos", payload: { title: "Sobre a clínica", tagline: null, data: { lines: ["Linha"] } } });
  assert.equal((await app.inject({ url: "/api/knowledge/status" })).json().state, "unpublished");
});

test("POST /api/knowledge/publish: 409 while the RAG is already indexing", async () => {
  rag.busy = true;
  const res = await app.inject({ method: "POST", url: "/api/knowledge/publish" });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: "already indexing" });
});

test("POST /api/knowledge/publish: 502 when the RAG is unavailable", async () => {
  rag.down = true;
  const res = await app.inject({ method: "POST", url: "/api/knowledge/publish" });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, "rag_unavailable");
});

test("a fact flagged assessment changes the version, which follows the clinic language", async () => {
  const flagged = {
    title: "Limpeza Dental",
    tagline: "O primeiro passo",
    data: { ...treatmentData, facts: [{ label: "Preço", value: "R$ 50", assessment: true }] },
  };
  assert.equal((await app.inject({ method: "PUT", url: "/api/knowledge/limpeza-dental", payload: flagged })).statusCode, 200);
  const rows = await repo.list();
  const status = (await app.inject({ url: "/api/knowledge/status" })).json();
  assert.equal(status.state, "unpublished");
  assert.equal(status.version, toDocument(CLINIC, rows, "pt").version);
  assert.notEqual(status.version, toDocument(CLINIC, rows, "en").version);

  const english = Fastify();
  await english.register(panelKnowledgeRoutes({ repo, rag, clinicName: CLINIC, language: "en" }));
  await english.ready();
  assert.equal((await english.inject({ url: "/api/knowledge/status" })).json().version, toDocument(CLINIC, rows, "en").version);
});
