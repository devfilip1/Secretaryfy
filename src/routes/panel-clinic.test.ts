import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { createClinicContext, type ClinicContext } from "../modules/clinic/context.js";
import { panelClinicRoutes } from "./panel-clinic.js";

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
  assert.deepEqual(res.json(), { name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "pt", restartRequired: false });
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
    payload: { name: "  Sorriso Pleno  ", assistantName: "", kind: "physiotherapy clinic" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { name: "Sorriso Pleno", assistantName: null, kind: "physiotherapy clinic", language: "pt", restartRequired: false });
  assert.deepEqual(saved, [{ name: "Sorriso Pleno", assistantName: undefined, kind: "physiotherapy clinic" }]);
  assert.equal(clinic.name, "Sorriso Pleno");
  assert.equal(clinic.assistantName, undefined);
});

test("PUT inválido é 400 invalid_body com o campo, e não grava nada", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ name: "", assistantName: "Ana", kind: "dental clinic" }, "name"],
    [{ name: "x".repeat(121), assistantName: "", kind: "dental clinic" }, "name"],
    [{ name: "DentalSafe", assistantName: "x".repeat(61), kind: "dental clinic" }, "assistantName"],
    [{ name: "DentalSafe", assistantName: "", kind: "" }, "kind"],
    [{ name: "DentalSafe", kind: "dental clinic" }, "assistantName"],
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
