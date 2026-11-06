import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { createClinicContext } from "../modules/clinic/context.js";
import { clinicInternalRoutes } from "./clinic-internal.js";

const TOKEN = "t".repeat(32);
const IDENTITY = { name: "Sorriso Pleno", kind: "clínica odontológica", language: "pt" as const };

async function appWith(token: string): Promise<{ app: FastifyInstance; clinic: ReturnType<typeof createClinicContext> }> {
  const clinic = createClinicContext(IDENTITY);
  const app = Fastify();
  await app.register(clinicInternalRoutes({ clinic, token }));
  await app.ready();
  return { app, clinic };
}

const get = (app: FastifyInstance, authorization?: string) =>
  app.inject({ method: "GET", url: "/internal/clinic", headers: authorization === undefined ? {} : { authorization } });

test("401 without the Authorization header, and with a wrong token", async () => {
  const { app } = await appWith(TOKEN);
  assert.equal((await get(app)).statusCode, 401);
  assert.equal((await get(app, `Bearer ${"x".repeat(32)}`)).statusCode, 401);
});

test("200 with name, kind and language read from the live clinic context", async () => {
  const { app } = await appWith(TOKEN);
  const res = await get(app, `Bearer ${TOKEN}`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), IDENTITY);
});

test("a rename in the clinic context shows on the next request, without a restart", async () => {
  const { app, clinic } = await appWith(TOKEN);
  clinic.update({ name: "Outra Clínica", kind: "clínica de estética" });
  const res = await get(app, `Bearer ${TOKEN}`);
  assert.deepEqual(res.json(), { ...IDENTITY, name: "Outra Clínica", kind: "clínica de estética" });
});

test("without a configured token the route does not exist", async () => {
  const { app } = await appWith("");
  assert.equal((await get(app, "Bearer ")).statusCode, 404);
});
