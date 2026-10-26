import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { sign } from "../config/crypto.js";
import { createConnectionStore, type ConnectionStore } from "../modules/google/connection.js";
import { CONNECT_STATE, GOOGLE_SCOPES } from "../modules/google/oauth.js";
import { createTestDb } from "../test/db.js";
import { googleOAuthRoutes } from "./google-oauth.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: FastifyInstance;
let connection: ConnectionStore;
let grantedScopes: string;
let exchangeFails: boolean;

before(async () => {
  testDb = await createTestDb();
});
after(() => testDb.close());

beforeEach(async () => {
  await testDb.db.execute(sql`delete from calendar_connection`);
  grantedScopes = GOOGLE_SCOPES.join(" ");
  exchangeFails = false;
  connection = createConnectionStore({ db: testDb.db as never, publish: () => {} });
  app = Fastify();
  await app.register(
    googleOAuthRoutes({
      connection,
      panelUrl: "http://panel.test",
      exchangeCode: async (code) => {
        if (exchangeFails) throw new Error("invalid_grant");
        return { refreshToken: `token-${code}`, scopes: grantedScopes, email: "clinica@gmail.com" };
      },
      listCalendars: async () => [
        { id: "outra", name: "Feriados", timeZone: "UTC", primary: false },
        { id: "primary", name: "clinica@gmail.com", timeZone: "America/Bahia", primary: true },
      ],
    }),
  );
});

const callback = (query: string) => app.inject({ url: `/auth/google/callback?${query}` });
const validState = () => encodeURIComponent(sign(CONNECT_STATE, 600));

test("state válido grava a agenda principal e volta ao painel", async () => {
  const res = await callback(`code=abc&state=${validState()}`);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "http://panel.test/#/calendar?google=connected");
  const saved = await connection.get();
  assert.equal(saved.status, "connected");
  assert.equal(saved.calendarId, "primary");
  assert.equal(saved.timeZone, "America/Bahia");
  assert.equal((await connection.getForUse())?.refreshToken, "token-abc");
});

test("operador cancelou no Google: aviso e a conexão existente não muda", async () => {
  await callback(`code=abc&state=${validState()}`);
  const res = await callback(`error=access_denied&state=${validState()}`);
  assert.equal(res.headers.location, "http://panel.test/#/calendar?google=denied");
  assert.equal((await connection.getForUse())?.refreshToken, "token-abc");
});

test("state inválido, vencido ou de outro uso dá erro e não grava", async () => {
  for (const state of ["lixo", sign(CONNECT_STATE, -1), sign("outra-coisa", 600)]) {
    const res = await callback(`code=abc&state=${encodeURIComponent(state)}`);
    assert.equal(res.headers.location, "http://panel.test/#/calendar?google=error");
  }
  assert.equal((await connection.get()).status, "disconnected");
});

test("falha ao trocar o code dá erro", async () => {
  exchangeFails = true;
  const res = await callback(`code=abc&state=${validState()}`);
  assert.equal(res.headers.location, "http://panel.test/#/calendar?google=error");
  assert.equal((await connection.get()).status, "disconnected");
});

test("escopo de agenda desmarcado não grava", async () => {
  grantedScopes = "openid email https://www.googleapis.com/auth/calendar.events";
  const res = await callback(`code=abc&state=${validState()}`);
  assert.equal(res.headers.location, "http://panel.test/#/calendar?google=missing_scope");
  assert.equal((await connection.get()).status, "disconnected");
});
