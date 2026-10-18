import assert from "node:assert/strict";
import { test } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { createSessionToken, SESSION_COOKIE } from "../modules/auth/session.js";
import { registerPanelAuth } from "./panel-session.js";

const PASSWORD = "senha-do-operador";

async function build({ password = PASSWORD as string | null } = {}) {
  const app = Fastify();
  await app.register(cookie);
  registerPanelAuth(app, { password: password ?? undefined, publicUrl: "http://localhost:3000" });
  app.get("/api/protegida", async () => ({ ok: true }));
  app.post("/api/protegida", async () => ({ ok: true }));
  app.get("/health", async () => ({ status: "ok" }));
  return app;
}

const loginWith = (app: Awaited<ReturnType<typeof build>>, password: string) =>
  app.inject({ method: "POST", url: "/api/session", payload: { password } });

test("senha certa grava o cookie de sessão", async () => {
  const app = await build();
  const res = await loginWith(app, PASSWORD);
  assert.equal(res.statusCode, 204);
  const set = String(res.headers["set-cookie"]);
  assert.match(set, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.doesNotMatch(set, /Secure/);
});

test("senha errada dá 401 genérico e a sexta falha seguida dá 429", async () => {
  const app = await build();
  for (let i = 0; i < 5; i++) {
    const res = await loginWith(app, "errada-errada-errada");
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "invalid_credentials" });
  }
  const blocked = await loginWith(app, PASSWORD);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().error, "too_many_attempts");
  assert.ok(blocked.json().retry_after_s > 0);
});

test("GET /api/session diz se há sessão", async () => {
  const app = await build();
  assert.equal((await app.inject({ url: "/api/session" })).statusCode, 401);
  const ok = await app.inject({ url: "/api/session", cookies: { [SESSION_COOKIE]: createSessionToken() } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { authenticated: true });
});

test("DELETE /api/session apaga o cookie", async () => {
  const app = await build();
  const res = await app.inject({ method: "DELETE", url: "/api/session" });
  assert.equal(res.statusCode, 204);
  assert.match(String(res.headers["set-cookie"]), /sf_session=;/);
});

test("rotas /api exigem sessão; as outras não", async () => {
  const app = await build();
  const res = await app.inject({ url: "/api/protegida" });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: "unauthenticated" });
  assert.equal((await app.inject({ url: "/api/protegida", cookies: { [SESSION_COOKIE]: createSessionToken() } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/health" })).statusCode, 200);
});

test("POST sem JSON dá 415", async () => {
  const app = await build();
  const res = await app.inject({
    method: "POST",
    url: "/api/protegida",
    cookies: { [SESSION_COOKIE]: createSessionToken() },
    headers: { "content-type": "text/plain" },
    payload: "oi",
  });
  assert.equal(res.statusCode, 415);
});

test("sem OPERATOR_PASSWORD todas as rotas /api dão 503", async () => {
  const app = await build({ password: null });
  for (const url of ["/api/session", "/api/protegida"]) {
    const res = await app.inject({ url, cookies: { [SESSION_COOKIE]: createSessionToken() } });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { error: "panel_disabled" });
  }
  assert.equal((await loginWith(app, PASSWORD)).statusCode, 503);
});
