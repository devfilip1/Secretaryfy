import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { createTestDb } from "../../test/db.js";
import { createInboxRepository, type InboxRepository } from "./repository.js";

let close: () => Promise<unknown>;
let repo: InboxRepository;
let reset: () => Promise<unknown>;

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
beforeEach(() => reset());

const at = (min: number) => new Date(Date.UTC(2026, 9, 16, 13, min));

async function conversation(phone = "5511999999999", name: string | null = "Maria") {
  return repo.upsertConversation({ phone, name, at: at(0), preview: "Oi" });
}

test("upsert por telefone mantém a conversa e só troca o nome quando vem preenchido", async () => {
  const a = await conversation("5511999999999", "Maria");
  const b = await repo.upsertConversation({ phone: "5511999999999", name: null, at: at(1), preview: "x" });
  const c = await repo.upsertConversation({ phone: "5511999999999", name: "Maria Silva", at: at(2), preview: "x" });
  assert.equal(b.id, a.id);
  assert.equal(b.name, "Maria");
  assert.equal(c.name, "Maria Silva");
});

test("o mesmo wa_message_id entra uma vez só", async () => {
  const conv = await conversation();
  const values = { conversationId: conv.id, waMessageId: "W1", origin: "customer" as const, type: "text" as const, text: "Oi", status: "received" as const, sentAt: at(1) };
  assert.ok(await repo.insertMessage(values));
  assert.equal(await repo.insertMessage(values), null);
  // Vários envios ainda sem id convivem
  const pending = { ...values, waMessageId: null, origin: "operator" as const, status: "sending" as const };
  assert.ok(await repo.insertMessage(pending));
  assert.ok(await repo.insertMessage(pending));
});

test("lista de conversas ordenada e filtrada por nome ou número", async () => {
  const maria = await conversation("5511999999999", "Maria");
  const joao = await conversation("5521988887777", "João");
  await repo.touchConversation(joao.id, { lastMessageAt: at(5), preview: "último", incrementUnread: true });

  const all = await repo.listConversations();
  assert.deepEqual(all.map((c) => c.id), [joao.id, maria.id]);
  assert.equal(all[0].unreadCount, 1);
  assert.equal(all[0].lastMessagePreview, "último");
  assert.deepEqual((await repo.listConversations({ q: "mar" })).map((c) => c.id), [maria.id]);
  assert.deepEqual((await repo.listConversations({ q: "8888" })).map((c) => c.id), [joao.id]);
});

test("touch não troca a prévia por uma mensagem mais antiga", async () => {
  const conv = await conversation();
  await repo.touchConversation(conv.id, { lastMessageAt: at(10), preview: "nova", incrementUnread: false });
  const row = await repo.touchConversation(conv.id, { lastMessageAt: at(5), preview: "velha", incrementUnread: false });
  assert.equal(row.lastMessagePreview, "nova");
  assert.equal(row.lastMessageAt.getTime(), at(10).getTime());
});

test("mensagens em páginas, da mais recente para trás, em ordem cronológica", async () => {
  const conv = await conversation();
  for (let i = 1; i <= 5; i++) {
    await repo.insertMessage({ conversationId: conv.id, waMessageId: `W${i}`, origin: "customer", type: "text", text: `m${i}`, status: "received", sentAt: at(i) });
  }
  const first = await repo.listMessages(conv.id, { limit: 2 });
  assert.deepEqual(first.messages.map((m) => m.text), ["m4", "m5"]);
  assert.equal(first.hasMore, true);
  const second = await repo.listMessages(conv.id, { before: first.messages[0].id, limit: 2 });
  assert.deepEqual(second.messages.map((m) => m.text), ["m2", "m3"]);
  const last = await repo.listMessages(conv.id, { before: second.messages[0].id, limit: 2 });
  assert.deepEqual(last.messages.map((m) => m.text), ["m1"]);
  assert.equal(last.hasMore, false);
});

test("eco pendente: mesmo texto, em sending, dentro da janela", async () => {
  const conv = await conversation();
  const row = await repo.insertMessage({ conversationId: conv.id, origin: "operator", type: "text", text: "Olá", status: "sending", sentAt: at(1) });
  assert.equal((await repo.findPendingEcho(conv.id, "Olá", new Date(Date.now() - 60_000)))?.id, row!.id);
  assert.equal(await repo.findPendingEcho(conv.id, "Outro", new Date(Date.now() - 60_000)), null);
  assert.equal(await repo.findPendingEcho(conv.id, "Olá", new Date(Date.now() + 60_000)), null);
});

test("pausa e leitura", async () => {
  const conv = await conversation();
  await repo.touchConversation(conv.id, { lastMessageAt: at(1), preview: "x", incrementUnread: true });
  assert.equal((await repo.setPaused(conv.id, true))?.assistantPaused, true);
  assert.equal((await repo.markRead(conv.id))?.unreadCount, 0);
});

test("transação desfaz tudo em caso de erro", async () => {
  const conv = await conversation();
  await assert.rejects(
    repo.transaction(async (tx) => {
      await tx.setPaused(conv.id, true);
      throw new Error("falhou");
    }),
  );
  assert.equal((await repo.findConversation(conv.id))?.assistantPaused, false);
});

test("mensagens do mesmo segundo saem na ordem em que chegaram", async () => {
  const conv = await conversation();
  for (const text of ["texto", "áudio", "imagem"]) {
    await repo.insertMessage({ conversationId: conv.id, waMessageId: text, origin: "customer", type: "text", text, status: "received", sentAt: at(1) });
  }
  const { messages } = await repo.listMessages(conv.id, { limit: 2 });
  assert.deepEqual(messages.map((m) => m.text), ["áudio", "imagem"]);
  const older = await repo.listMessages(conv.id, { before: messages[0].id, limit: 2 });
  assert.deepEqual(older.messages.map((m) => m.text), ["texto"]);
});
