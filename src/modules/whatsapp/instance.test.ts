import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboxEvent } from "../inbox/events.js";
import { AlreadyConnected, createInstanceManager, EvolutionError } from "./instance.js";

const env = {
  EVOLUTION_API_URL: "http://evo",
  EVOLUTION_API_KEY: "key",
  EVOLUTION_INSTANCE: "secretaryfy",
  EVOLUTION_WEBHOOK_TOKEN: "token-0000000000",
  PUBLIC_URL: "https://app.example.com",
};

type Route = (body: unknown) => { status?: number; body?: unknown };

function fakeEvolution(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: unknown; apikey: string | null }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace(env.EVOLUTION_API_URL, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, apikey: new Headers(init.headers).get("apikey") });
    const route = routes[`${method} ${path}`];
    if (!route) return new Response("not found", { status: 404 });
    const out = route(body);
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function manager(routes: Record<string, Route>) {
  const evo = fakeEvolution(routes);
  const events: InboxEvent[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const m = createInstanceManager({
    fetch: evo.fetch,
    publish: (e) => events.push(e),
    env,
    setInterval: ((fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval,
    clearInterval: (() => timers.splice(0)) as unknown as typeof clearInterval,
  });
  return { m, evo, events, timers };
}

const STATE = "GET /instance/connectionState/secretaryfy";
const OWNER = "GET /instance/fetchInstances?instanceName=secretaryfy";

test("applyEvent: conexão aberta define o número e apaga o QR code", () => {
  const { m, events } = manager({});
  m.applyEvent({ kind: "qrcode", qr: "data:image/png;base64,QR" });
  assert.deepEqual(m.getState(), { state: "connecting", number: null, qr: "data:image/png;base64,QR" });
  m.applyEvent({ kind: "connection", state: "open", number: "5511988887777" });
  assert.deepEqual(m.getState(), { state: "open", number: "5511988887777", qr: null });
  m.applyEvent({ kind: "connection", state: "close", number: null });
  assert.deepEqual(m.getState(), { state: "close", number: null, qr: null });
  assert.equal(events.length, 3);
  assert.ok(events.every((e) => e.type === "connection.updated"));
});

test("refresh lê o estado e o número, com a apikey", async () => {
  const { m, evo } = manager({
    [STATE]: () => ({ body: { instance: { state: "open" } } }),
    [OWNER]: () => ({ body: [{ ownerJid: "5511988887777@s.whatsapp.net" }] }),
  });
  assert.deepEqual(await m.refresh(), { state: "open", number: "5511988887777", qr: null });
  assert.ok(evo.calls.every((c) => c.apikey === "key"));
  assert.equal(m.isKnown(), true);
});

test("prepareQr cria a instância se não existir, configura o webhook e pede o QR code", async () => {
  const { m, evo } = manager({
    "POST /instance/create": () => ({ status: 201 }),
    "POST /webhook/set/secretaryfy": () => ({}),
    "GET /instance/connect/secretaryfy": () => ({ body: { base64: "data:image/png;base64,QR" } }),
  });
  const state = await m.prepareQr();

  assert.deepEqual(state, { state: "connecting", number: null, qr: "data:image/png;base64,QR" });
  assert.deepEqual(evo.calls.map((c) => `${c.method} ${c.path}`), [
    STATE,
    "POST /instance/create",
    "POST /webhook/set/secretaryfy",
    "GET /instance/connect/secretaryfy",
  ]);
  assert.deepEqual(evo.calls[1].body, { instanceName: "secretaryfy", integration: "WHATSAPP-BAILEYS", qrcode: true });
  assert.deepEqual(evo.calls[2].body, {
    webhook: {
      enabled: true,
      url: "https://app.example.com/webhooks/evolution?token=token-0000000000",
      byEvents: false,
      base64: false,
      events: ["MESSAGES_UPSERT", "SEND_MESSAGE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
    },
  });
});

test("prepareQr simultâneos fazem um só pedido à Evolution", async () => {
  const { m, evo } = manager({
    [STATE]: () => ({ body: { instance: { state: "close" } } }),
    "POST /webhook/set/secretaryfy": () => ({}),
    "GET /instance/connect/secretaryfy": () => ({ body: { base64: "data:image/png;base64,QR" } }),
  });
  const [a, b] = await Promise.all([m.prepareQr(), m.prepareQr()]);
  assert.deepEqual(a, b);
  assert.equal(evo.calls.filter((c) => c.path === "/instance/connect/secretaryfy").length, 1);
  await m.prepareQr();
  assert.equal(evo.calls.filter((c) => c.path === "/instance/connect/secretaryfy").length, 2);
});

test("prepareQr com o número já conectado lança AlreadyConnected", async () => {
  const { m } = manager({
    [STATE]: () => ({ body: { instance: { state: "open" } } }),
    [OWNER]: () => ({ body: [{ ownerJid: "5511988887777@s.whatsapp.net" }] }),
  });
  await assert.rejects(m.prepareQr(), AlreadyConnected);
});

test("erros da Evolution API viram EvolutionError", async () => {
  const { m } = manager({ [STATE]: () => ({ status: 500, body: { error: "boom" } }) });
  await assert.rejects(m.refresh(), (err) => err instanceof EvolutionError && err.status === 500);
  const offline = createInstanceManager({
    fetch: (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch,
    publish: () => {},
    env,
  });
  await assert.rejects(offline.refresh(), EvolutionError);
});

test("logout desconecta e limpa o estado", async () => {
  const { m, evo } = manager({ "DELETE /instance/logout/secretaryfy": () => ({}) });
  m.applyEvent({ kind: "connection", state: "open", number: "5511988887777" });
  await m.logout();
  assert.equal(evo.calls.at(-1)?.method, "DELETE");
  assert.deepEqual(m.getState(), { state: "close", number: null, qr: null });
});

test("polling a cada 10 s, só uma vez, e para quando pedido", () => {
  const { m, timers } = manager({});
  m.startPolling();
  m.startPolling();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 10_000);
  assert.equal(m.isPolling(), true);
  m.stopPolling();
  assert.equal(m.isPolling(), false);
});

test("com WEBHOOK_BASE_URL, o webhook usa esse endereço em vez de PUBLIC_URL", async () => {
  const evo = fakeEvolution({
    [STATE]: () => ({ body: { instance: { state: "close" } } }),
    "POST /webhook/set/secretaryfy": () => ({}),
    "GET /instance/connect/secretaryfy": () => ({ body: { base64: "data:image/png;base64,QR" } }),
  });
  const m = createInstanceManager({
    fetch: evo.fetch,
    publish: () => {},
    env: { ...env, WEBHOOK_BASE_URL: "http://host.docker.internal:3000" },
  });
  await m.prepareQr();
  const set = evo.calls.find((c) => c.path === "/webhook/set/secretaryfy");
  assert.equal(
    (set?.body as { webhook: { url: string } }).webhook.url,
    "http://host.docker.internal:3000/webhooks/evolution?token=token-0000000000",
  );
});
