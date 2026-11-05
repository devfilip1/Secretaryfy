import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { parseBrochure } from "../modules/knowledge/import-markdown.js";
import { toDocument, toSections } from "../modules/knowledge/render.js";
import { knowledgeInternalRoutes } from "./knowledge-internal.js";

const TOKEN = "t".repeat(32);
const CLINIC = "Sorriso Pleno";
const rows = parseBrochure(
  "## Limpeza Dental — O primeiro passo\nO que você ganha:\n- Boca limpa\nComo funciona: Ultrassom.\nDuração: 30 min   |   Preço: R$ 40\nResultado: Imediato\n\n## Sobre nós\nLinha um\n",
);

async function appWith(token: string): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(knowledgeInternalRoutes({ repo: { list: async () => rows }, clinicName: CLINIC, token }));
  await app.ready();
  return app;
}

test("401 without the Authorization header", async () => {
  const app = await appWith(TOKEN);
  const res = await app.inject({ method: "GET", url: "/internal/knowledge" });
  assert.equal(res.statusCode, 401);
});

test("401 with a wrong token, or with another scheme", async () => {
  const app = await appWith(TOKEN);
  const wrong = await app.inject({ method: "GET", url: "/internal/knowledge", headers: { authorization: `Bearer ${"x".repeat(32)}` } });
  const basic = await app.inject({ method: "GET", url: "/internal/knowledge", headers: { authorization: `Basic ${TOKEN}` } });
  assert.equal(wrong.statusCode, 401);
  assert.equal(basic.statusCode, 401);
});

test("200 with the contract: name, version and sections", async () => {
  const app = await appWith(TOKEN);
  const res = await app.inject({ method: "GET", url: "/internal/knowledge", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body, toDocument(CLINIC, rows));
  assert.equal(body.name, CLINIC);
  assert.deepEqual(body.sections, toSections(rows));
  assert.match(body.version, /^[0-9a-f]{64}$/);
});

test("without a configured token the route does not exist", async () => {
  const app = await appWith("");
  const res = await app.inject({ method: "GET", url: "/internal/knowledge", headers: { authorization: "Bearer " } });
  assert.equal(res.statusCode, 404);
});
