import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { createSessionToken, SESSION_COOKIE } from "../modules/auth/session.js";
import { createConnectionStore, type ConnectionStore } from "../modules/google/connection.js";
import { CalendarUnavailable } from "../modules/google/gateway.js";
import type { InboxEvent } from "../modules/inbox/events.js";
import { createRulesStore, DEFAULT_RULES } from "../modules/scheduling/rules.js";
import { createTestDb } from "../test/db.js";
import { createFakeCalendar, type FakeCalendar } from "../test/fake-calendar.js";
import { panelCalendarRoutes } from "./panel-calendar.js";
import { registerPanelAuth } from "./panel-session.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: FastifyInstance;
let connection: ConnectionStore;
let fake: FakeCalendar;
let events: InboxEvent[];
let revoked: string[];
let revokeFails: boolean;
let googleConfigured: boolean;

before(async () => {
  testDb = await createTestDb();
});
after(() => testDb.close());

beforeEach(async () => {
  await testDb.db.execute(sql`delete from calendar_connection`);
  await testDb.db.execute(sql`delete from scheduling_rules`);
  events = [];
  revoked = [];
  revokeFails = false;
  googleConfigured = true;
  connection = createConnectionStore({ db: testDb.db as never, publish: (e) => events.push(e) });
  fake = createFakeCalendar({
    calendars: [
      { id: "primary", name: "clinica@gmail.com", timeZone: "America/Bahia", primary: true },
      { id: "teste@group.calendar.google.com", name: "DentalSafe teste", timeZone: "America/Sao_Paulo", primary: false },
    ],
  });
  app = Fastify();
  await app.register(cookie);
  registerPanelAuth(app, { password: "senha-do-operador", publicUrl: "http://localhost:3000" });
  await app.register(
    panelCalendarRoutes({
      connection,
      calendar: fake.gateway,
      rules: createRulesStore(testDb.db as never),
      buildConnectUrl: () => "https://accounts.google.com/o/oauth2/v2/auth?state=x",
      googleConfigured: () => googleConfigured,
      revoke: async (token) => {
        revoked.push(token);
        if (revokeFails) throw new Error("Google fora do ar");
      },
    }),
  );
});

const auth = { [SESSION_COOKIE]: createSessionToken() };
const get = (url: string) => app.inject({ url, cookies: auth });
const send = (method: "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload, cookies: auth });

const connect = () =>
  connection.save({
    email: "clinica@gmail.com",
    refreshToken: "1//token",
    scopes: "",
    calendar: { id: "primary", name: "clinica@gmail.com", timeZone: "America/Bahia" },
  });

test("sem sessão, as rotas da agenda dão 401", async () => {
  assert.equal((await app.inject({ url: "/api/calendar" })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/calendar/connect", payload: {} })).statusCode, 401);
});

test("GET /api/calendar: desconectada e com as regras padrão", async () => {
  const res = await get("/api/calendar");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    connection: { status: "disconnected", email: null, calendarId: null, calendarName: null, timeZone: null },
    rules: DEFAULT_RULES,
  });
});

test("GET /api/calendar: conectada", async () => {
  await connect();
  const body = (await get("/api/calendar")).json();
  assert.equal(body.connection.status, "connected");
  assert.equal(body.connection.email, "clinica@gmail.com");
  assert.equal(body.connection.timeZone, "America/Bahia");
});

test("POST /api/calendar/connect devolve a URL do Google", async () => {
  const res = await send("POST", "/api/calendar/connect", {});
  assert.equal(res.statusCode, 200);
  assert.match(res.json().url, /^https:\/\/accounts\.google\.com\//);
});

test("POST /api/calendar/connect sem credenciais reais do Google: 503 google_not_configured", async () => {
  googleConfigured = false;
  const res = await send("POST", "/api/calendar/connect", {});
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: "google_not_configured" });
});

test("GET /api/calendar/calendars: 409 desconectada, lista conectada e 502 com o Google fora", async () => {
  assert.deepEqual((await get("/api/calendar/calendars")).json(), { error: "calendar_disconnected" });
  assert.equal((await get("/api/calendar/calendars")).statusCode, 409);

  await connect();
  const list = (await get("/api/calendar/calendars")).json();
  assert.deepEqual(list.calendars.map((c: { id: string }) => c.id), ["primary", "teste@group.calendar.google.com"]);

  fake.failNext(new CalendarUnavailable("fora"));
  const failed = await get("/api/calendar/calendars");
  assert.equal(failed.statusCode, 502);
  assert.deepEqual(failed.json(), { error: "calendar_unavailable" });
});

test("listar as agendas corrige o fuso gravado se ele mudou no Google", async () => {
  await connection.save({
    email: "clinica@gmail.com",
    refreshToken: "1//token",
    scopes: "",
    calendar: { id: "primary", name: "clinica@gmail.com", timeZone: "UTC" },
  });
  await get("/api/calendar/calendars");
  assert.equal((await get("/api/calendar")).json().connection.timeZone, "America/Bahia");
});

test("PUT /api/calendar/selection troca a agenda; agenda fora da lista dá 422", async () => {
  await connect();
  const bad = await send("PUT", "/api/calendar/selection", { calendarId: "outra" });
  assert.equal(bad.statusCode, 422);
  assert.deepEqual(bad.json(), { error: "invalid_calendar" });

  const ok = await send("PUT", "/api/calendar/selection", { calendarId: "teste@group.calendar.google.com" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().connection.calendarName, "DentalSafe teste");
  assert.equal(ok.json().connection.timeZone, "America/Sao_Paulo");
  assert.ok(events.some((e) => e.type === "calendar.updated"));
});

test("PUT /api/calendar/rules valida e salva", async () => {
  const bad = await send("PUT", "/api/calendar/rules", {
    ...DEFAULT_RULES,
    weeklyHours: { "1": { start: "18:00", end: "09:00" } },
  });
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json().error, "invalid_rules");
  assert.deepEqual(bad.json().issues.map((i: { path: string }) => i.path), ["weeklyHours.1.end"]);

  const rules = { ...DEFAULT_RULES, slotMinutes: 30, weeklyHours: { "6": { start: "08:00", end: "12:00" } } };
  const ok = await send("PUT", "/api/calendar/rules", rules);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().rules, rules);
  assert.deepEqual((await get("/api/calendar")).json().rules, rules);
});

test("DELETE /api/calendar revoga e desconecta, mesmo se a revogação falhar", async () => {
  await connect();
  revokeFails = true;
  const res = await send("DELETE", "/api/calendar");
  assert.equal(res.statusCode, 204);
  assert.deepEqual(revoked, ["1//token"]);
  assert.equal((await get("/api/calendar")).json().connection.status, "disconnected");

  // Sem conexão, continua 204 e não revoga nada
  assert.equal((await send("DELETE", "/api/calendar")).statusCode, 204);
  assert.equal(revoked.length, 1);
});
