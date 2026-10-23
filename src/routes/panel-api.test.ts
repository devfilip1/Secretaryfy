import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { createSessionToken, SESSION_COOKIE } from "../modules/auth/session.js";
import type { ConnectionJson, InboxEvent } from "../modules/inbox/events.js";
import { createInboxRepository, type InboxRepository } from "../modules/inbox/repository.js";
import { createInboxService, type InboxService } from "../modules/inbox/service.js";
import type { IncomingMessage } from "../modules/whatsapp/evolution.js";
import { createBreaker } from "../modules/antiban/breaker.js";
import { createGate, type Gate } from "../modules/antiban/gate.js";
import { createAntibanRepository, type AntibanRepository } from "../modules/antiban/repository.js";
import { AlreadyConnected, EvolutionError, TooManyAttempts } from "../modules/whatsapp/instance.js";
import { TEST_ANTIBAN } from "../test/antiban.js";
import { createTestDb } from "../test/db.js";
import { panelApiRoutes } from "./panel-api.js";
import { registerPanelAuth } from "./panel-session.js";

let close: () => Promise<unknown>;
let repo: InboxRepository;
let antibanRepo: AntibanRepository;
let execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
let reset: () => Promise<unknown>;

before(async () => {
  const testDb = await createTestDb();
  close = testDb.close;
  repo = createInboxRepository(testDb.db as never);
  antibanRepo = createAntibanRepository(testDb.db as never);
  execute = (query) => testDb.db.execute(query);
  reset = async () => {
    await testDb.db.execute(sql`delete from messages`);
    await testDb.db.execute(sql`delete from conversations`);
    await testDb.db.execute(sql`delete from contact_preferences`);
    await testDb.db.execute(sql`delete from protection_state`);
  };
});
after(() => close());

let app: FastifyInstance;
let inbox: InboxService;
let events: InboxEvent[];
let connection: ConnectionJson;
let sent: [string, string][];
let sendFails: boolean;
let qrError: Error | null;
let gate: Gate;
let clock: number;

beforeEach(async () => {
  await reset();
  events = [];
  sent = [];
  sendFails = false;
  qrError = null;
  connection = { state: "open", number: "5511988887777", qr: null };
  clock = Date.now();
  inbox = createInboxService({ repo, publish: (e) => events.push(e), now: () => clock, retryMinIntervalMs: 30_000 });
  const breaker = createBreaker({ repo: antibanRepo, config: TEST_ANTIBAN });
  gate = createGate({
    config: TEST_ANTIBAN,
    repo: antibanRepo,
    inboxRepo: repo,
    inbox,
    breaker,
    send: async () => ({ waId: "x" }),
    markRead: async () => {},
    connectedNumber: () => null,
    publish: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} } as never,
  });
  app = Fastify();
  await app.register(cookie);
  registerPanelAuth(app, { password: "senha-do-operador", publicUrl: "http://localhost:3000" });
  await app.register(
    panelApiRoutes({
      inbox,
      repo,
      instance: {
        getState: () => connection,
        isKnown: () => true,
        refresh: async () => connection,
        prepareQr: async () => {
          if (qrError) throw qrError;
          return { state: "connecting", number: null, qr: "data:image/png;base64,AAA" };
        },
        logout: async () => {
          connection = { state: "close", number: null, qr: null };
        },
      },
      send: async (phone, text) => {
        sent.push([phone, text]);
        if (sendFails) throw new Error("Evolution API 500");
        return { waId: `OUT${sent.length}` };
      },
      risks: (conversation) => gate.operatorRisks(conversation),
    }),
  );
});

const auth = { [SESSION_COOKIE]: createSessionToken() };
const get = (url: string) => app.inject({ url, cookies: auth });
const post = (url: string, payload: object = {}) => app.inject({ method: "POST", url, payload, cookies: auth });
const patch = (url: string, payload: object) => app.inject({ method: "PATCH", url, payload, cookies: auth });

async function customerSays(text: string, id = `IN${Math.random()}`, phone = "5511999999999", name = "Maria") {
  const msg: IncomingMessage = { kind: "message", id, phone, pushName: name, fromMe: false, type: "text", text, sentAt: new Date() };
  return (await inbox.recordIncoming(msg)).conversation;
}

// --- US1: acompanhar ---

test("lista de conversas no formato do contrato, com busca", async () => {
  await customerSays("Oi", "A", "5511999999999", "Maria");
  await customerSays("Olá", "B", "5521988887777", "João");

  const all = (await get("/api/conversations")).json();
  assert.deepEqual(all.conversations.map((c: { name: string }) => c.name), ["João", "Maria"]);
  assert.deepEqual(Object.keys(all.conversations[0]).sort(), [
    "assistantPaused", "id", "lastMessageAt", "lastMessagePreview", "name", "needsAttention", "optedOut", "phone", "unreadCount",
  ]);
  const found = (await get("/api/conversations?q=mar")).json();
  assert.deepEqual(found.conversations.map((c: { name: string }) => c.name), ["Maria"]);
});

test("mensagens da conversa com paginação; id inexistente dá 404", async () => {
  const conv = await customerSays("primeira", "A");
  await customerSays("segunda", "B");
  await customerSays("terceira", "C");

  const page = (await get(`/api/conversations/${conv.id}/messages?limit=2`)).json();
  assert.deepEqual(page.messages.map((m: { text: string }) => m.text), ["segunda", "terceira"]);
  assert.equal(page.hasMore, true);
  assert.equal(page.conversation.id, conv.id);
  const older = (await get(`/api/conversations/${conv.id}/messages?limit=2&before=${page.messages[0].id}`)).json();
  assert.deepEqual(older.messages.map((m: { text: string }) => m.text), ["primeira"]);

  assert.equal((await get(`/api/conversations/${crypto.randomUUID()}/messages`)).statusCode, 404);
  assert.equal((await get("/api/conversations/nao-e-uuid/messages")).statusCode, 404);
  assert.equal((await get(`/api/conversations/${conv.id}/messages?limit=500`)).statusCode, 422);
});

test("marcar como lida zera e publica", async () => {
  const conv = await customerSays("Oi");
  events = [];
  assert.equal((await post(`/api/conversations/${conv.id}/read`)).statusCode, 204);
  assert.equal((await repo.findConversation(conv.id))?.unreadCount, 0);
  assert.deepEqual(events.map((e) => e.type), ["conversation.updated"]);
});

test("sem sessão nada responde", async () => {
  assert.equal((await app.inject({ url: "/api/conversations" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/connection" })).statusCode, 401);
});

// --- US2: enviar ---

test("envio do operador chega ao cliente, fica sent e pausa o assistente", async () => {
  const conv = await customerSays("Oi");
  const res = await post(`/api/conversations/${conv.id}/messages`, { text: "  Olá, sou da recepção\nTudo bem?  " });

  assert.equal(res.statusCode, 201);
  assert.equal(res.json().message.origin, "operator");
  assert.equal(res.json().message.status, "sent");
  assert.equal(res.json().message.text, "Olá, sou da recepção\nTudo bem?");
  assert.deepEqual(sent, [["5511999999999", "Olá, sou da recepção\nTudo bem?"]]);
  assert.equal(await inbox.isPaused(conv.id), true);
});

test("texto vazio ou longo demais dá 422 sem gravar", async () => {
  const conv = await customerSays("Oi");
  assert.equal((await post(`/api/conversations/${conv.id}/messages`, { text: "   " })).statusCode, 422);
  assert.equal((await post(`/api/conversations/${conv.id}/messages`, { text: "a".repeat(4097) })).statusCode, 422);
  assert.equal((await repo.listMessages(conv.id)).messages.length, 1);
  assert.deepEqual(sent, []);
});

test("WhatsApp desconectado: 409 sem gravar", async () => {
  const conv = await customerSays("Oi");
  connection = { state: "close", number: null, qr: null };
  const res = await post(`/api/conversations/${conv.id}/messages`, { text: "Olá" });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: "whatsapp_disconnected" });
  assert.equal((await repo.listMessages(conv.id)).messages.length, 1);
  assert.equal(await inbox.isPaused(conv.id), false);
});

test("falha no envio dá 502 com a mensagem failed, e o reenvio funciona", async () => {
  const conv = await customerSays("Oi");
  sendFails = true;
  const res = await post(`/api/conversations/${conv.id}/messages`, { text: "Olá" });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().message.status, "failed");
  assert.equal(res.json().message.error, "Evolution API 500");

  sendFails = false;
  const retry = await post(`/api/messages/${res.json().message.id}/retry`);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().message.status, "sent");
  assert.equal(sent.length, 2);
  // Reenviar de novo uma mensagem já enviada não é permitido
  assert.equal((await post(`/api/messages/${res.json().message.id}/retry`)).statusCode, 409);
});

test("mensagem do assistente não pode ser reenviada pelo painel", async () => {
  const conv = await customerSays("Oi");
  const out = await inbox.startOutgoing({ conversationId: conv.id, origin: "assistant", text: "x" });
  await inbox.finishOutgoing(out.id, { error: "falhou" });
  assert.equal((await post(`/api/messages/${out.id}/retry`)).statusCode, 409);
});

// --- US4: pausar ---

test("pausar e reativar o assistente pela API", async () => {
  const conv = await customerSays("Oi");
  events = [];
  const paused = await patch(`/api/conversations/${conv.id}`, { assistantPaused: true });
  assert.equal(paused.statusCode, 200);
  assert.equal(paused.json().assistantPaused, true);
  assert.deepEqual(events.map((e) => e.type), ["conversation.updated"]);
  assert.equal((await patch(`/api/conversations/${conv.id}`, { assistantPaused: false })).json().assistantPaused, false);
  assert.equal((await patch(`/api/conversations/${conv.id}`, { assistantPaused: "sim" })).statusCode, 422);
  assert.equal((await patch(`/api/conversations/${crypto.randomUUID()}`, { assistantPaused: true })).statusCode, 404);
});

// --- US3: conexão ---

test("estado, QR code e desconexão", async () => {
  assert.deepEqual((await get("/api/connection")).json(), connection);

  const qr = await post("/api/connection/qr");
  assert.equal(qr.statusCode, 200);
  assert.equal(qr.json().qr, "data:image/png;base64,AAA");

  qrError = new AlreadyConnected();
  assert.equal((await post("/api/connection/qr")).statusCode, 409);
  qrError = new EvolutionError("Evolution API inacessível");
  const down = await post("/api/connection/qr");
  assert.equal(down.statusCode, 502);
  assert.equal(down.json().error, "evolution_unavailable");

  assert.equal((await app.inject({ method: "DELETE", url: "/api/connection", cookies: auth })).statusCode, 204);
  assert.equal(connection.state, "close");
});

test("desconectar o WhatsApp apaga todas as conversas e avisa o painel", async () => {
  await customerSays("Oi", "A", "5511999999999", "Maria");
  await customerSays("Olá", "B", "5521988887777", "João");
  events = [];

  assert.equal((await app.inject({ method: "DELETE", url: "/api/connection", cookies: auth })).statusCode, 204);
  assert.deepEqual((await get("/api/conversations")).json().conversations, []);
  assert.deepEqual(events, [{ type: "conversations.cleared" }]);
});

// --- Proteção do número (specs/004) ---

async function coldConversation() {
  const conv = await customerSays("Oi");
  await execute(sql`update messages set sent_at = now() - interval '25 hours' where conversation_id = ${conv.id}`);
  return conv;
}

test("contato frio: 409 com o risco e nada gravado; confirmando, envia (US4)", async () => {
  const conv = await coldConversation();
  const refused = await post(`/api/conversations/${conv.id}/messages`, { text: "Olá" });
  assert.equal(refused.statusCode, 409);
  assert.deepEqual(refused.json(), { error: "risk_confirmation_required", risks: ["cold_contact"] });
  assert.equal((await repo.listMessages(conv.id)).messages.length, 1);
  assert.deepEqual(sent, []);

  const confirmed = await post(`/api/conversations/${conv.id}/messages`, { text: "Olá", confirmRisk: true });
  assert.equal(confirmed.statusCode, 201);
  assert.deepEqual(sent, [["5511999999999", "Olá"]]);
});

test("conversa recente envia sem aviso; cliente que saiu e freio ativo pedem confirmação", async () => {
  const conv = await customerSays("Oi");
  assert.equal((await post(`/api/conversations/${conv.id}/messages`, { text: "1" })).statusCode, 201);

  await repo.setOptedOut(conv.phone, new Date());
  await antibanRepo.setPaused(new Date(Date.now() + 60_000), "send_failures");
  const refused = await post(`/api/conversations/${conv.id}/messages`, { text: "2" });
  assert.equal(refused.statusCode, 409);
  assert.deepEqual(refused.json().risks, ["opted_out", "protection_paused"]);
});

test("reenvio em menos de 30 s dá 429 retry_too_soon (FR-025)", async () => {
  const conv = await customerSays("Oi");
  sendFails = true;
  const failed = (await post(`/api/conversations/${conv.id}/messages`, { text: "Olá" })).json().message;
  assert.equal((await post(`/api/messages/${failed.id}/retry`)).statusCode, 502);
  const tooSoon = await post(`/api/messages/${failed.id}/retry`);
  assert.equal(tooSoon.statusCode, 429);
  assert.equal(tooSoon.json().error, "retry_too_soon");
  clock += 30_000;
  sendFails = false;
  assert.equal((await post(`/api/messages/${failed.id}/retry`)).statusCode, 200);
});

test("o operador reativa quem pediu para sair, mas não marca a saída (US3)", async () => {
  const conv = await customerSays("Oi");
  await repo.setOptedOut(conv.phone, new Date());
  assert.equal((await get(`/api/conversations/${conv.id}/messages`)).json().conversation.optedOut, true);
  assert.equal((await patch(`/api/conversations/${conv.id}`, { optedOut: true })).statusCode, 422);

  const res = await patch(`/api/conversations/${conv.id}`, { optedOut: false });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().optedOut, false);
  const history = (await repo.listMessages(conv.id)).messages;
  assert.ok(history.some((m) => m.origin === "system" && m.text === "✅ Mensagens reativadas pelo operador"));
});

test("limpar as conversas ao desconectar não esquece quem pediu para sair", async () => {
  const conv = await customerSays("Oi");
  await inbox.setOptedOut(conv.id, true, "🚫");
  await inbox.clearAll();
  await customerSays("Voltei");
  const [again] = (await get("/api/conversations")).json().conversations;
  assert.equal(again.optedOut, true);
});

test("pedidos de QR demais: 429 too_many_attempts (FR-029)", async () => {
  qrError = new TooManyAttempts(new Date("2026-10-18T12:10:00Z"));
  const res = await post("/api/connection/qr");
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.json(), { error: "too_many_attempts", retryAt: "2026-10-18T12:10:00.000Z" });
});
