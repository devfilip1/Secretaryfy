import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { createTestDb } from "../../test/db.js";
import type { IncomingMessage } from "../whatsapp/evolution.js";
import type { InboxEvent } from "./events.js";
import { createInboxRepository, type InboxRepository } from "./repository.js";
import { createInboxService, type InboxService } from "./service.js";

let close: () => Promise<unknown>;
let repo: InboxRepository;
let reset: () => Promise<unknown>;
let events: InboxEvent[];
let service: InboxService;

before(async () => {
  const testDb = await createTestDb();
  close = testDb.close;
  repo = createInboxRepository(testDb.db as never);
  reset = async () => {
    await testDb.db.execute(sql`delete from messages`);
    await testDb.db.execute(sql`delete from conversations`);
  };
});
after(() => close());
beforeEach(async () => {
  await reset();
  events = [];
  service = createInboxService({ repo, publish: (e) => events.push(e) });
});

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    kind: "message",
    id: "W1",
    phone: "5511999999999",
    pushName: "Maria",
    fromMe: false,
    type: "text",
    text: "How much are braces?",
    sentAt: new Date(),
    ...overrides,
  };
}

test("mensagem do cliente é registrada, conta como não lida e publica os eventos", async () => {
  const { created, conversation, message } = await service.recordIncoming(incoming());

  assert.equal(created, true);
  assert.equal(message?.origin, "customer");
  assert.equal(message?.status, "received");
  assert.equal(conversation.unreadCount, 1);
  assert.equal(conversation.name, "Maria");
  assert.equal(conversation.lastMessagePreview, "How much are braces?");
  assert.deepEqual(events.map((e) => e.type), ["message.created", "conversation.updated"]);
});

test("o mesmo evento duas vezes é registrado uma vez", async () => {
  await service.recordIncoming(incoming());
  const second = await service.recordIncoming(incoming());
  assert.equal(second.created, false);
  const { messages } = await repo.listMessages(second.conversation.id);
  assert.equal(messages.length, 1);
  assert.equal((await repo.findConversation(second.conversation.id))?.unreadCount, 1);
});

test("eco de um envio já com id é ignorado", async () => {
  const { conversation } = await service.recordIncoming(incoming());
  const out = await service.startOutgoing({ conversationId: conversation.id, origin: "assistant", text: "Braces cost $180–$450." });
  await service.finishOutgoing(out.id, { waId: "OUT1" });

  const echo = await service.recordIncoming(incoming({ id: "OUT1", fromMe: true, text: "Braces cost $180–$450." }));
  assert.equal(echo.created, false);
  assert.equal((await repo.listMessages(conversation.id)).messages.length, 2);
});

test("eco que chega antes da resposta do envio é casado pelo texto", async () => {
  const { conversation } = await service.recordIncoming(incoming());
  const out = await service.startOutgoing({ conversationId: conversation.id, origin: "operator", text: "Olá, sou da recepção" });

  const echo = await service.recordIncoming(incoming({ id: "OUT2", fromMe: true, text: "Olá, sou da recepção" }));
  assert.equal(echo.created, false);
  const updated = await repo.findMessage(out.id);
  assert.equal(updated?.waMessageId, "OUT2");
  assert.equal(updated?.status, "sent");

  // A resposta do sendText chega depois e não duplica nada
  await service.finishOutgoing(out.id, { waId: "OUT2" });
  const { messages } = await repo.listMessages(conversation.id);
  assert.deepEqual(messages.map((m) => m.origin), ["customer", "operator"]);
});

test("mensagem enviada pelo celular entra como phone e não muda o nome nem as não lidas", async () => {
  const { conversation } = await service.recordIncoming(incoming());
  const phone = await service.recordIncoming(incoming({ id: "P1", fromMe: true, pushName: undefined, text: "Oi, aqui é o doutor" }));

  assert.equal(phone.created, true);
  assert.equal(phone.message?.origin, "phone");
  assert.equal(phone.message?.status, "sent");
  assert.equal(phone.conversation.name, "Maria");
  assert.equal(phone.conversation.unreadCount, conversation.unreadCount);
});

test("se o eco entrou como celular antes da resposta do envio, fica só a mensagem do sistema", async () => {
  const { conversation } = await service.recordIncoming(incoming());
  const out = await service.startOutgoing({ conversationId: conversation.id, origin: "assistant", text: "Resposta" });
  // Texto diferente (ex.: normalizado pela Evolution API): o eco não casa e entra como celular
  await service.recordIncoming(incoming({ id: "OUT3", fromMe: true, text: "Resposta " }));
  await service.finishOutgoing(out.id, { waId: "OUT3" });

  const { messages } = await repo.listMessages(conversation.id);
  assert.deepEqual(messages.map((m) => [m.origin, m.waMessageId]), [["customer", "W1"], ["assistant", "OUT3"]]);
});

test("envio com falha fica failed com o motivo", async () => {
  const { conversation } = await service.recordIncoming(incoming());
  const out = await service.startOutgoing({ conversationId: conversation.id, origin: "assistant", text: "x" });
  const failed = await service.finishOutgoing(out.id, { error: "Evolution API 500" });
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.error, "Evolution API 500");
  assert.equal(events.at(-1)?.type, "message.updated");
});

test("startOutgoing com pause pausa o assistente na mesma operação", async () => {
  const { conversation } = await service.recordIncoming(incoming());
  assert.equal(await service.isPaused(conversation.id), false);
  await service.startOutgoing({ conversationId: conversation.id, origin: "operator", text: "Assumi", pause: true });
  assert.equal(await service.isPaused(conversation.id), true);
});

test("mídia registra o tipo e a prévia com o rótulo", async () => {
  const { conversation, message } = await service.recordIncoming(incoming({ type: "audio", text: null }));
  assert.equal(message?.type, "audio");
  assert.equal(conversation.lastMessagePreview, "🎤 Áudio");
});

test("markRead zera as não lidas e publica", async () => {
  const { conversation } = await service.recordIncoming(incoming());
  events = [];
  const row = await service.markRead(conversation.id);
  assert.equal(row?.unreadCount, 0);
  assert.deepEqual(events.map((e) => e.type), ["conversation.updated"]);
});

// --- specs/003: agendamento ---

test("flagNeedsAttention pausa e destaca; abrir a conversa ou reativar o assistente tira o destaque", async () => {
  const { conversation } = await service.recordIncoming(incoming());
  events = [];
  const flagged = await service.flagNeedsAttention(conversation.id);
  assert.equal(flagged?.assistantPaused, true);
  assert.equal(flagged?.needsAttention, true);
  assert.deepEqual(events.map((e) => e.type), ["conversation.updated"]);

  assert.equal((await service.markRead(conversation.id))?.needsAttention, false);
  await service.flagNeedsAttention(conversation.id);
  // Pausar de novo não tira o destaque; reativar tira
  assert.equal((await service.setAssistantPaused(conversation.id, true))?.needsAttention, true);
  const reactivated = await service.setAssistantPaused(conversation.id, false);
  assert.equal(reactivated?.needsAttention, false);
  assert.equal(reactivated?.assistantPaused, false);
});

test("recordSystem grava o registro sem contar como não lida nem entrar no contexto do modelo", async () => {
  const { conversation } = await service.recordIncoming(incoming());
  events = [];
  const note = await service.recordSystem(conversation.id, "📅 Agendado pelo assistente: qua, 21/10 às 10:00 (60 min)");
  assert.equal(note?.origin, "system");
  assert.equal(note?.status, "received");
  assert.equal(note?.waMessageId, null);
  assert.deepEqual(events.map((e) => e.type), ["message.created"]);

  const after = await repo.findConversation(conversation.id);
  assert.equal(after?.unreadCount, 1);
  assert.equal(after?.lastMessagePreview, "How much are braces?");
  assert.deepEqual(await service.recentHistory(conversation.id), [{ role: "user", content: "How much are braces?" }]);
});

test("recentHistory: últimas mensagens de texto em ordem, cliente como user e o resto como assistant", async () => {
  const base = Date.now();
  const { conversation } = await service.recordIncoming(incoming({ id: "A", text: "oi", sentAt: new Date(base) }));
  await service.recordIncoming(incoming({ id: "B", fromMe: true, text: "Olá!", sentAt: new Date(base + 1000) }));
  await service.recordIncoming(incoming({ id: "C", type: "audio", text: null, sentAt: new Date(base + 2000) }));
  await service.recordIncoming(incoming({ id: "D", text: "tudo bem?", sentAt: new Date(base + 3000) }));

  assert.deepEqual(await service.recentHistory(conversation.id), [
    { role: "user", content: "oi" },
    { role: "assistant", content: "Olá!" },
    { role: "user", content: "tudo bem?" },
  ]);
  assert.deepEqual((await service.recentHistory(conversation.id, 2)).map((m) => m.content), ["Olá!", "tudo bem?"]);
});
