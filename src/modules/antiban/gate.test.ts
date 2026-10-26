import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { TEST_ANTIBAN } from "../../test/antiban.js";
import { fakeClock } from "../../test/clock.js";
import { createTestDb } from "../../test/db.js";
import type { InboxEvent } from "../inbox/events.js";
import { createInboxRepository, type InboxRepository } from "../inbox/repository.js";
import { createInboxService, type InboxService } from "../inbox/service.js";
import { createBreaker } from "./breaker.js";
import { createGate, type Gate } from "./gate.js";
import type { AntibanConfig } from "./limits.js";
import { LINK_PLACEHOLDER } from "./links.js";
import { createAntibanRepository, type AntibanRepository } from "./repository.js";
import { protectionNotes } from "./texts.js";
import { typingDelay } from "./typing.js";

const QUIET = { info: () => {}, warn: () => {}, error: () => {} } as never;
// Sem intervalos entre envios: as regras são testadas sem esperar
const FAST: AntibanConfig = { ...TEST_ANTIBAN, gapMinMs: 0, gapMaxMs: 0, readMinMs: 0, readMaxMs: 0, thinkMinMs: 0, thinkMaxMs: 0 };

let close: () => Promise<unknown>;
let execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
let repo: InboxRepository;
let antibanRepo: AntibanRepository;

before(async () => {
  const testDb = await createTestDb();
  close = testDb.close;
  execute = (query) => testDb.db.execute(query);
  repo = createInboxRepository(testDb.db as never);
  antibanRepo = createAntibanRepository(testDb.db as never);
});
after(() => close());

let inbox: InboxService;
let events: InboxEvent[];
let sent: { phone: string; text: string; delayMs?: number }[];
let failSends: boolean;
let connected: string | null;

beforeEach(async () => {
  for (const table of ["messages", "conversations", "contact_preferences", "protection_state", "connected_numbers"]) {
    await execute(sql.raw(`delete from ${table}`));
  }
  events = [];
  sent = [];
  failSends = false;
  connected = null;
  inbox = createInboxService({ repo, publish: (e) => events.push(e) });
});

function gateWith(config: AntibanConfig = FAST): Gate {
  const breaker = createBreaker({ repo: antibanRepo, config, onChange: (s) => void gate.onBreakerChange(s) });
  const gate = createGate({
    config,
    repo: antibanRepo,
    inboxRepo: repo,
    inbox,
    breaker,
    send: async (phone, text, opts) => {
      if (failSends) throw new Error("Evolution API 500");
      sent.push({ phone, text, delayMs: opts?.delayMs });
      return { waId: `OUT${sent.length}-${Math.random()}` };
    },
    markRead: async () => {},
    connectedNumber: () => connected,
    publish: (e) => events.push(e),
    log: QUIET,
  });
  return gate;
}

let seq = 0;
async function customerSays(phone = "5511999999999", text = "Oi", sentAt = new Date()) {
  const { conversation } = await inbox.recordIncoming({
    kind: "message",
    id: `IN${++seq}`,
    phone,
    pushName: "Maria",
    fromMe: false,
    type: "text",
    text,
    sentAt,
  });
  return conversation;
}

const ask = (gate: Gate, conversation: { id: string; phone: string }, text = `Resposta ${++seq}`) =>
  gate.sendAssistant({ conversationId: conversation.id, phone: conversation.phone, text });

async function lastMessage(conversationId: string) {
  return (await repo.listMessages(conversationId)).messages.filter((m) => m.origin !== "system").at(-1)!;
}

async function systemNotes(conversationId: string) {
  return (await repo.listMessages(conversationId)).messages.filter((m) => m.origin === "system").map((m) => m.text);
}

test("resposta normal sai com tempo de digitação dentro dos limites", async () => {
  const conv = await customerSays();
  assert.equal(await ask(gateWith(), conv, "Hello"), "sent");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].delayMs! >= FAST.typingMinMs && sent[0].delayMs! <= FAST.typingMaxMs);
  assert.equal((await lastMessage(conv.id)).status, "sent");
});

test("conversas por dia: a 3ª conversa nova passa do limite 2, e uma já atendida continua (FR-011)", async () => {
  const gate = gateWith({ ...FAST, conversationsPerDay: 2 });
  const a = await customerSays("5511900000001");
  const b = await customerSays("5511900000002");
  const c = await customerSays("5511900000003");
  assert.equal(await ask(gate, a), "sent");
  assert.equal(await ask(gate, b), "sent");
  assert.equal(await ask(gate, c), "blocked");
  const blocked = await lastMessage(c.id);
  assert.deepEqual([blocked.status, blocked.error], ["blocked", "daily_conversations"]);
  assert.equal((await repo.findConversation(c.id))?.needsAttention, true);
  assert.deepEqual(await systemNotes(c.id), [protectionNotes.dailyConversations]);

  await customerSays("5511900000001", "e mais uma coisa");
  assert.equal(await ask(gate, a), "sent");
});

test("insistência: 3 respostas sem o cliente responder, a 4ª não sai e não destaca (FR-013)", async () => {
  const gate = gateWith();
  const conv = await customerSays();
  for (let i = 0; i < 3; i++) assert.equal(await ask(gate, conv), "sent");
  assert.equal(await ask(gate, conv), "blocked");
  assert.equal((await lastMessage(conv.id)).error, "unanswered");
  assert.equal((await repo.findConversation(conv.id))?.needsAttention, false);
});

test("laço com outro robô: não envia, pausa e destaca com o motivo (FR-014, FR-015)", async () => {
  const gate = gateWith();
  const conv = await customerSays("5511999999999", "Oi", new Date(Date.now() - 600_000));
  // Cinco trocas em que o contato responde 1 s depois do assistente
  let at = Date.now() - 500_000;
  for (let i = 0; i < 5; i++) {
    await repo.insertMessage({ conversationId: conv.id, origin: "assistant", type: "text", text: `a${i}`, status: "sent", sentAt: new Date(at) });
    await repo.insertMessage({
      conversationId: conv.id,
      waMessageId: `BOT${i}`,
      origin: "customer",
      type: "text",
      text: `menu ${i}`,
      status: "received",
      sentAt: new Date(at + 1000),
    });
    at += 30_000;
  }
  assert.equal(await ask(gate, conv), "blocked");
  assert.equal((await lastMessage(conv.id)).error, "loop");
  const row = await repo.findConversation(conv.id);
  assert.deepEqual([row?.assistantPaused, row?.needsAttention], [true, true]);
  assert.deepEqual(await systemNotes(conv.id), [protectionNotes.loop]);
  assert.deepEqual(sent, []);
});

test("texto idêntico ao último em 30 min não sai de novo (FR-016)", async () => {
  const gate = gateWith();
  const conv = await customerSays();
  assert.equal(await ask(gate, conv, "Hello!"), "sent");
  await customerSays(conv.phone, "?");
  assert.equal(await ask(gate, conv, "Hello!"), "blocked");
  assert.equal((await lastMessage(conv.id)).error, "duplicate");
});

test("variações: a 4ª indisponibilidade em 30 min não tem texto novo (FR-017)", async () => {
  const gate = gateWith();
  const conv = await customerSays();
  const options = ["A", "B", "C"];
  for (const expected of options) {
    const text = await gate.pickVariant(conv.id, options);
    assert.equal(text, expected);
    await customerSays(conv.phone, "?");
    await ask(gate, conv, text!);
  }
  assert.equal(await gate.pickVariant(conv.id, options), null);
});

test("links: a primeira resposta sai sem nenhum; nas demais, só os da lista (FR-018)", async () => {
  const gate = gateWith({ ...FAST, allowedLinkDomains: ["dentalsafe.com"] });
  const conv = await customerSays();
  await ask(gate, conv, "See https://dentalsafe.com/prices");
  assert.equal(sent[0].text, `See ${LINK_PLACEHOLDER}`);
  await customerSays(conv.phone, "?");
  await ask(gate, conv, "See https://dentalsafe.com/prices and https://other.com");
  assert.equal(sent[1].text, `See https://dentalsafe.com/prices and ${LINK_PLACEHOLDER}`);
});

test("quem pediu para sair não recebe nada; a confirmação com bypass sai uma vez (FR-020, SC-004)", async () => {
  const gate = gateWith();
  const conv = await customerSays();
  await repo.setOptedOut(conv.phone, new Date());
  assert.equal(
    await gate.sendAssistant({ conversationId: conv.id, phone: conv.phone, text: "Done", bypass: ["opted_out", "unanswered"] }),
    "sent",
  );
  assert.equal(await ask(gate, conv), "blocked");
  assert.equal((await lastMessage(conv.id)).error, "opted_out");
  assert.deepEqual(sent.map((s) => s.text), ["Done"]);
});

test("fora da janela de 24 h o assistente não envia (FR-001, SC-005)", async () => {
  const conv = await customerSays("5511999999999", "Oi", new Date(Date.now() - 25 * 3_600_000));
  assert.equal(await ask(gateWith(), conv), "blocked");
  assert.equal((await lastMessage(conv.id)).error, "outside_window");
  assert.deepEqual(await gateWith().operatorRisks(conv), ["cold_contact"]);
});

test("a resposta que ficaria tempo demais na fila não sai e destaca a conversa (FR-012)", async () => {
  const gate = gateWith({ ...FAST, perMinute: 1, queueMaxAgeMs: 1000 });
  const a = await customerSays("5511900000001");
  const b = await customerSays("5511900000002");
  assert.equal(await ask(gate, a), "sent");
  assert.equal(await ask(gate, b), "blocked");
  assert.equal((await lastMessage(b.id)).error, "rate_limited");
  assert.deepEqual(await systemNotes(b.id), [protectionNotes.rateLimited]);
});

test("5 falhas de envio ligam o freio: nada mais sai, e o operador é avisado do risco (FR-026, FR-027)", async () => {
  const gate = gateWith();
  failSends = true;
  for (let i = 0; i < 5; i++) {
    const conv = await customerSays(`55119000000${10 + i}`);
    assert.equal(await ask(gate, conv), "failed");
  }
  failSends = false;
  const conv = await customerSays("5511900000099");
  assert.equal(await ask(gate, conv), "blocked");
  assert.equal((await lastMessage(conv.id)).error, "paused");
  assert.deepEqual(await systemNotes(conv.id), [protectionNotes.paused]);
  assert.deepEqual(await gate.operatorRisks(conv), ["protection_paused"]);
  assert.equal((await gate.protectionStatus()).state, "paused");
  assert.ok(events.some((e) => e.type === "protection.updated" && e.state === "paused"));
});

test("aquecimento: número conectado há 1 dia usa o limite reduzido de conversas (FR-024)", async () => {
  connected = "5511988887777";
  await antibanRepo.rememberConnectedNumber(connected, new Date(Date.now() - 24 * 3_600_000));
  const gate = gateWith({ ...FAST, warmupConversationsPerDay: 2 });
  const status = await gate.protectionStatus();
  assert.equal(status.state, "warmup");
  assert.ok(status.limits.conversationsPerDay < FAST.conversationsPerDay);

  const small = gateWith({ ...FAST, warmupConversationsPerDay: 2, conversationsPerDay: 2 });
  for (const phone of ["5511900000001", "5511900000002"]) assert.equal(await ask(small, await customerSays(phone)), "sent");
  assert.equal(await ask(small, await customerSays("5511900000003")), "blocked");
});

test("o operador respondeu enquanto a resposta esperava: ela não sai", async () => {
  const gate = gateWith();
  const conv = await customerSays();
  await inbox.setAssistantPaused(conv.id, true);
  assert.equal(await ask(gate, conv), "blocked");
  assert.equal((await lastMessage(conv.id)).error, "superseded");
});

// --- Ritmo (SC-002): tudo em memória, com relógio falso ---

test("20 respostas simultâneas: nunca mais de 8 envios em 60 s, e todas saem dentro do prazo da fila", async () => {
  const clock = fakeClock();
  const times: number[] = [];
  const config: AntibanConfig = { ...TEST_ANTIBAN, perMinute: 8, perHour: 200 };
  let id = 0;
  const gate = createGate({
    config,
    repo: {
      sentTimesSince: async () => [],
      countConversationsServedSince: async () => 0,
      servedConversationSince: async () => true,
      getConnectedNumber: async () => null,
    },
    inboxRepo: {
      isOptedOut: async () => false,
      lastCustomerMessageAt: async () => clock.now(),
      customerMessagesSinceLastReply: async () => [],
      recentForAssessment: async () => [],
      assistantTextsSince: async () => [],
      hasAssistantReply: async () => true,
      operatorWroteSince: async () => false,
    },
    inbox: {
      startOutgoing: async (v) => ({ id: `m${++id}`, createdAt: clock.now(), text: v.text, conversationId: v.conversationId }) as never,
      finishOutgoing: async () => null,
      recordBlocked: async () => null,
      blockOutgoing: async () => null,
      flagNeedsAttention: async () => null,
      recordSystem: async () => null,
      isPaused: async () => false,
    },
    breaker: { current: async () => ({ paused: false, pausedUntil: null, reason: null }), recordFailure: async () => {} },
    send: async () => {
      times.push(clock.now().getTime());
      return { waId: `W${times.length}` };
    },
    markRead: async () => {},
    connectedNumber: () => null,
    publish: () => {},
    log: QUIET,
    now: clock.now,
    setTimeout: clock.setTimeout,
  });

  const results = Promise.all(
    Array.from({ length: 20 }, (_, i) => gate.sendAssistant({ conversationId: `c${i}`, phone: `55119000000${i}`, text: `r${i}` })),
  );
  for (let s = 0; s < 300 && times.length < 20; s++) await clock.advance(1000);
  assert.deepEqual(await results, Array(20).fill("sent"));
  for (const start of times) {
    assert.ok(times.filter((t) => t >= start && t < start + 60_000).length <= 8, "mais de 8 envios num minuto");
  }
  assert.ok(times.at(-1)! - times[0] <= config.queueMaxAgeMs);
});

// --- Visualizar e pensar antes de digitar (FR-005a, FR-005b) ---

function pacedGate(clock: ReturnType<typeof fakeClock>, customerAt: Date, timeline: string[]) {
  const t = () => clock.now().getTime() - customerAt.getTime();
  return createGate({
    config: TEST_ANTIBAN,
    repo: {
      sentTimesSince: async () => [],
      countConversationsServedSince: async () => 0,
      servedConversationSince: async () => true,
      getConnectedNumber: async () => null,
    },
    inboxRepo: {
      isOptedOut: async () => false,
      lastCustomerMessageAt: async () => customerAt,
      customerMessagesSinceLastReply: async () => [
        { id: "m1", waMessageId: "W1", type: "text", text: "Oi, quero marcar", sentAt: customerAt },
      ],
      recentForAssessment: async () => [],
      assistantTextsSince: async () => [],
      hasAssistantReply: async () => true,
      operatorWroteSince: async () => false,
    },
    inbox: {
      startOutgoing: async (v) => ({ id: "out", createdAt: clock.now(), text: v.text, conversationId: v.conversationId }) as never,
      finishOutgoing: async () => null,
      recordBlocked: async () => null,
      blockOutgoing: async () => null,
      flagNeedsAttention: async () => null,
      recordSystem: async () => null,
      isPaused: async () => false,
    },
    breaker: { current: async () => ({ paused: false, pausedUntil: null, reason: null }), recordFailure: async () => {} },
    send: async (_phone, _text, opts) => {
      timeline.push(`envio ${t()} (digitando ${opts?.delayMs})`);
      return { waId: "OUT" };
    },
    markRead: async () => {
      timeline.push(`lida ${t()}`);
    },
    connectedNumber: () => null,
    publish: () => {},
    log: QUIET,
    now: clock.now,
    setTimeout: clock.setTimeout,
    random: () => 0.5,
  });
}

test("visualiza só depois da espera, e pausa antes de começar a digitar", async () => {
  const clock = fakeClock();
  // O cliente escreveu há 1 s (o agrupamento e o modelo já gastaram esse tempo)
  const customerAt = new Date(clock.now().getTime() - 1000);
  const timeline: string[] = [];
  const result = pacedGate(clock, customerAt, timeline).sendAssistant({ conversationId: "c1", phone: "5511999999999", text: "Sure!" });
  await clock.advance(30_000);
  assert.equal(await result, "sent");
  // random 0,5: visualiza 5 s depois da mensagem do cliente; pensa 1,08 s (16 caracteres); só então digita e envia
  assert.deepEqual(timeline, ["lida 5000", `envio 6080 (digitando ${typingDelay("Sure!", TEST_ANTIBAN, () => 0.5)})`]);
});

test("se a espera até visualizar já passou, visualiza na hora, mas ainda pausa antes de digitar", async () => {
  const clock = fakeClock();
  const customerAt = new Date(clock.now().getTime() - 20_000);
  const timeline: string[] = [];
  const result = pacedGate(clock, customerAt, timeline).sendAssistant({ conversationId: "c1", phone: "5511999999999", text: "Sure!" });
  await clock.advance(30_000);
  assert.equal(await result, "sent");
  assert.equal(timeline[0], "lida 20000");
  assert.match(timeline[1], /^envio 21080 /);
});


test("assistantBlockReason: o mesmo motivo que sendAssistant daria, sem gravar nem destacar (specs/006 R4)", async () => {
  const gate = gateWith({ ...FAST, conversationsPerDay: 1 });
  const check = (conv: { id: string; phone: string }, text = "Reminder") =>
    gate.assistantBlockReason({ conversationId: conv.id, phone: conv.phone, text });
  const count = async (conversationId: string) => (await repo.listMessages(conversationId)).messages.length;

  const ok = await customerSays("5511900000001");
  assert.equal(await check(ok), null);

  const cold = await customerSays("5511900000002", "Oi", new Date(Date.now() - 25 * 3_600_000));
  assert.equal(await check(cold), "outside_window");

  const out = await customerSays("5511900000003");
  await repo.setOptedOut(out.phone, new Date());
  assert.equal(await check(out), "opted_out");

  // Uma conversa atendida esgota o limite do dia para as outras
  assert.equal(await ask(gate, ok, "Hello"), "sent");
  const fresh = await customerSays("5511900000004");
  assert.equal(await check(fresh), "daily_conversations");
  assert.equal(await check(ok, "Hello"), "duplicate");

  for (const conv of [cold, out, fresh]) {
    assert.equal(await count(conv.id), 1, "só a mensagem do cliente");
    assert.equal((await repo.findConversation(conv.id))?.needsAttention, false);
  }
  assert.deepEqual(sent.map((s) => s.text), ["Hello"]);
});
