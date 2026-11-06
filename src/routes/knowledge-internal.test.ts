import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { WeeklyHours } from "../db/schema.js";
import { hoursLines } from "../modules/knowledge/hours.js";
import { parseBrochure } from "../modules/knowledge/import-markdown.js";
import { toDocument, toSections } from "../modules/knowledge/render.js";
import { knowledgeRowSchema } from "../modules/knowledge/types.js";
import type { Language } from "../modules/scheduling/dates.js";
import { CLINIC_HOURS } from "../test/hours.js";
import { createClinicContext } from "../modules/clinic/context.js";
import { knowledgeInternalRoutes } from "./knowledge-internal.js";

const TOKEN = "t".repeat(32);
const CLINIC = "Sorriso Pleno";
const rows = parseBrochure(
  "## Limpeza Dental — O primeiro passo\nO que você ganha:\n- Boca limpa\nComo funciona: Ultrassom.\nDuração: 30 min   |   Preço: R$ 40\nResultado: Imediato\n\n## Sobre nós\nLinha um\n",
);

async function appWith(
  token: string,
  language: Language = "pt",
  sections = rows,
  weeklyHours: WeeklyHours = CLINIC_HOURS,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(
    knowledgeInternalRoutes({ repo: { list: async () => sections }, rules: { get: async () => ({ weeklyHours }) }, clinic: { name: CLINIC }, language, token }),
  );
  await app.ready();
  return app;
}

test("the name is read when the request comes: renaming the clinic changes the version", async () => {
  const clinic = createClinicContext({ name: CLINIC, kind: "dental clinic", language: "pt" });
  const app = Fastify();
  await app.register(
    knowledgeInternalRoutes({ repo: { list: async () => rows }, rules: { get: async () => ({ weeklyHours: CLINIC_HOURS }) }, clinic, language: "pt", token: TOKEN }),
  );
  await app.ready();
  const fetchDocument = async () => (await app.inject({ method: "GET", url: "/internal/knowledge", headers: { authorization: `Bearer ${TOKEN}` } })).json();
  const before = await fetchDocument();
  clinic.update({ name: "Outra Clínica" });
  const after = await fetchDocument();
  assert.equal(after.name, "Outra Clínica");
  assert.notEqual(after.version, before.version);
});

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
  const hours = hoursLines(CLINIC_HOURS, "pt");
  assert.deepEqual(body, toDocument(CLINIC, rows, "pt", hours));
  assert.equal(body.name, CLINIC);
  assert.deepEqual(body.sections, toSections(rows, "pt", hours));
  assert.match(body.version, /^[0-9a-f]{64}$/);
});

test("the version follows the hours of the rules, since the clinic section carries them", async () => {
  const clinicRows = parseBrochure("## Clínica — Info\nENDEREÇO\nRua A\nHORÁRIO\nSábado: 9h às 14h\nCONTATO\nagenda@teste.example\n");
  const changed = { ...CLINIC_HOURS, "6": { start: "09:00", end: "12:00" } };
  const before = await appWith(TOKEN, "pt", clinicRows, CLINIC_HOURS);
  const after = await appWith(TOKEN, "pt", clinicRows, changed);
  const headers = { authorization: `Bearer ${TOKEN}` };
  const a = (await before.inject({ method: "GET", url: "/internal/knowledge", headers })).json();
  const b = (await after.inject({ method: "GET", url: "/internal/knowledge", headers })).json();
  assert.notEqual(a.version, b.version);
  assert.equal(b.version, toDocument(CLINIC, clinicRows, "pt", hoursLines(changed, "pt")).version);
  assert.ok(b.sections[0].body.includes("Sábado: 9h às 12h"));
});

test("without a configured token the route does not exist", async () => {
  const app = await appWith("");
  const res = await app.inject({ method: "GET", url: "/internal/knowledge", headers: { authorization: "Bearer " } });
  assert.equal(res.statusCode, 404);
});

test("a fact flagged assessment carries the note in the clinic language, and the version follows it", async () => {
  const flagged = [
    knowledgeRowSchema.parse({
      key: "limpeza-dental",
      kind: "treatment",
      title: "Limpeza Dental",
      tagline: null,
      data: { facts: [{ label: "Price", value: "$40-$85", assessment: true }] },
      position: 0,
    }),
  ];
  const app = await appWith(TOKEN, "en", flagged);
  const res = await app.inject({ method: "GET", url: "/internal/knowledge", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.deepEqual(res.json().sections[0].body, ["Price: $40-$85 (final value set at the assessment)"]);
  assert.equal(res.json().version, toDocument(CLINIC, flagged, "en", hoursLines(CLINIC_HOURS, "en")).version);
  assert.notEqual(res.json().version, toDocument(CLINIC, flagged, "pt", hoursLines(CLINIC_HOURS, "pt")).version);
});
