import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { createClinicContext, type ClinicContext } from "../modules/clinic/context.js";
import { panelClinicRoutes } from "./panel-clinic.js";

/** Os quatro campos novos com o padrão de uma clínica recém-criada. */
const IDENTITY_DEFAULTS = { offerAssessment: true, offerFollowUp: false, assessmentMinutes: null, followUpMinutes: null };

/** Repositório falso: guarda o que foi gravado, na ordem. */
function setup() {
  const clinic = createClinicContext({ name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "pt" });
  const saved: unknown[] = [];
  const repo = { save: async (identity: unknown) => void saved.push(identity) };
  return { clinic, saved, repo };
}

async function appFor(clinic: ClinicContext, repo: { save: (identity: unknown) => Promise<void> }) {
  const app = Fastify();
  await app.register(panelClinicRoutes({ clinic, repo: repo as never }));
  await app.ready();
  return app;
}

test("GET devolve a identidade, a língua e restartRequired false", async () => {
  const { clinic, repo } = setup();
  const app = await appFor(clinic, repo);
  const res = await app.inject({ method: "GET", url: "/api/clinic-settings" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ...IDENTITY_DEFAULTS, name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "pt", restartRequired: false });
});

test("GET sem nome da atendente devolve assistantName null", async () => {
  const clinic = createClinicContext({ name: "DentalSafe", kind: "dental clinic", language: "en" });
  const app = await appFor(clinic, setup().repo);
  assert.equal((await app.inject({ method: "GET", url: "/api/clinic-settings" })).json().assistantName, null);
});

test("PUT grava no repositório, troca a identidade na hora e responde no mesmo formato", async () => {
  const { clinic, saved, repo } = setup();
  const app = await appFor(clinic, repo);
  const res = await app.inject({
    method: "PUT",
    url: "/api/clinic-settings",
    payload: { name: "  Sorriso Pleno  ", assistantName: "", kind: "physiotherapy clinic", language: "pt" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ...IDENTITY_DEFAULTS, name: "Sorriso Pleno", assistantName: null, kind: "physiotherapy clinic", language: "pt", restartRequired: false });
  assert.deepEqual(saved, [{ ...IDENTITY_DEFAULTS, name: "Sorriso Pleno", assistantName: undefined, kind: "physiotherapy clinic", language: "pt" }]);
  assert.equal(clinic.name, "Sorriso Pleno");
  assert.equal(clinic.assistantName, undefined);
});

test("PUT com language troca a língua na hora, e o GET mostra a nova", async () => {
  const { clinic, saved, repo } = setup();
  const app = await appFor(clinic, repo);
  const res = await app.inject({
    method: "PUT",
    url: "/api/clinic-settings",
    payload: { name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "en" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(clinic.language, "en");
  assert.deepEqual(saved, [{ ...IDENTITY_DEFAULTS, name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "en" }]);
  assert.equal((await app.inject({ method: "GET", url: "/api/clinic-settings" })).json().language, "en");
});

test("PUT com language fora de en/pt é 400 e não muda a língua nem grava", async () => {
  const { clinic, saved, repo } = setup();
  const app = await appFor(clinic, repo);
  const res = await app.inject({
    method: "PUT",
    url: "/api/clinic-settings",
    payload: { name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "fr" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(clinic.language, "pt");
  assert.deepEqual(saved, []);
});

test("PUT inválido é 400 invalid_body com o campo, e não grava nada", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ name: "", assistantName: "Ana", kind: "dental clinic", language: "pt" }, "name"],
    [{ name: "x".repeat(121), assistantName: "", kind: "dental clinic", language: "pt" }, "name"],
    [{ name: "DentalSafe", assistantName: "x".repeat(61), kind: "dental clinic", language: "pt" }, "assistantName"],
    [{ name: "DentalSafe", assistantName: "", kind: "", language: "pt" }, "kind"],
    [{ name: "DentalSafe", kind: "dental clinic", language: "pt" }, "assistantName"],
    [{ name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "fr" }, "language"],
    [{ name: "DentalSafe", assistantName: "Ana", kind: "dental clinic" }, "language"],
  ];
  for (const [payload, field] of cases) {
    const { clinic, saved, repo } = setup();
    const app = await appFor(clinic, repo);
    const res = await app.inject({ method: "PUT", url: "/api/clinic-settings", payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.equal(res.json().error, "invalid_body");
    assert.ok(res.json().fields.some((f: { path: string }) => f.path === field), `campo ${field}`);
    assert.deepEqual(saved, []);
    assert.equal(clinic.name, "DentalSafe");
  }
});

test("PUT com os quatro campos novos grava, troca na hora e o GET devolve os mesmos valores", async () => {
  const { clinic, saved, repo } = setup();
  const app = await appFor(clinic, repo);
  const payload = { name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "pt", offerAssessment: false, offerFollowUp: true, assessmentMinutes: 30, followUpMinutes: 240 };
  const res = await app.inject({ method: "PUT", url: "/api/clinic-settings", payload });
  assert.equal(res.statusCode, 200);
  const expected = { offerAssessment: false, offerFollowUp: true, assessmentMinutes: 30, followUpMinutes: 240 };
  assert.deepEqual(saved, [{ name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "pt", ...expected }]);
  assert.equal(clinic.assessmentMinutes, 30);
  assert.equal(clinic.offerAssessment, false);
  const got = (await app.inject({ method: "GET", url: "/api/clinic-settings" })).json();
  assert.equal(got.offerAssessment, false);
  assert.equal(got.offerFollowUp, true);
  assert.equal(got.assessmentMinutes, 30);
  assert.equal(got.followUpMinutes, 240);
});

test("GET de uma clínica sem os campos novos devolve os padrões: avaliação sim, retorno não, duração null", async () => {
  const clinic = createClinicContext({ name: "DentalSafe", kind: "dental clinic", language: "en" });
  const app = await appFor(clinic, setup().repo);
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/clinic-settings" })).json(), { name: "DentalSafe", assistantName: null, kind: "dental clinic", language: "en", ...IDENTITY_DEFAULTS, restartRequired: false });
});

test("PUT sem os campos novos (cliente antigo) mantém os valores já gravados", async () => {
  const clinic = createClinicContext({ name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "pt", offerFollowUp: true, assessmentMinutes: 45, followUpMinutes: 20 });
  const { saved, repo } = setup();
  const app = await appFor(clinic, repo as never);
  const res = await app.inject({ method: "PUT", url: "/api/clinic-settings", payload: { name: "Sorriso", assistantName: "Ana", kind: "dental clinic", language: "pt" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.json().offerAssessment, res.json().offerFollowUp, res.json().assessmentMinutes, res.json().followUpMinutes], [true, true, 45, 20]);
  assert.deepEqual(saved, [{ name: "Sorriso", assistantName: "Ana", kind: "dental clinic", language: "pt", offerAssessment: true, offerFollowUp: true, assessmentMinutes: 45, followUpMinutes: 20 }]);
});

test("PUT com minutos null volta à duração padrão do calendário", async () => {
  const clinic = createClinicContext({ name: "DentalSafe", kind: "dental clinic", language: "pt", assessmentMinutes: 45 });
  const app = await appFor(clinic, setup().repo);
  const res = await app.inject({ method: "PUT", url: "/api/clinic-settings", payload: { name: "DentalSafe", assistantName: "", kind: "dental clinic", language: "pt", assessmentMinutes: null } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().assessmentMinutes, null);
  assert.equal(clinic.assessmentMinutes, null);
});

test("PUT com minutos inválidos é 400 no campo certo e não grava nada", async () => {
  const base = { name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "pt" };
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...base, assessmentMinutes: 10 }, "assessmentMinutes"],
    [{ ...base, assessmentMinutes: 245 }, "assessmentMinutes"],
    [{ ...base, assessmentMinutes: 17 }, "assessmentMinutes"],
    [{ ...base, assessmentMinutes: 0 }, "assessmentMinutes"],
    [{ ...base, assessmentMinutes: 30.5 }, "assessmentMinutes"],
    [{ ...base, assessmentMinutes: "30" }, "assessmentMinutes"],
    [{ ...base, followUpMinutes: 5 }, "followUpMinutes"],
    [{ ...base, followUpMinutes: 250 }, "followUpMinutes"],
    [{ ...base, followUpMinutes: 22 }, "followUpMinutes"],
    [{ ...base, offerFollowUp: "sim" }, "offerFollowUp"],
  ];
  for (const [payload, field] of cases) {
    const { clinic, saved, repo } = setup();
    const app = await appFor(clinic, repo);
    const res = await app.inject({ method: "PUT", url: "/api/clinic-settings", payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.equal(res.json().error, "invalid_body");
    assert.ok(res.json().fields.some((f: { path: string }) => f.path === field), `campo ${field}`);
    assert.deepEqual(saved, []);
    assert.equal(clinic.assessmentMinutes, null);
  }
});
