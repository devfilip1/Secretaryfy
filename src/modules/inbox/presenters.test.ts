import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaLabel, presentConversation, presentMessage, previewOf } from "./presenters.js";

test("rótulos de mídia", () => {
  assert.equal(mediaLabel("text"), null);
  assert.equal(mediaLabel("audio"), "🎤 Áudio");
  assert.equal(mediaLabel("image"), "📷 Imagem");
  assert.equal(mediaLabel("other"), "Mensagem não suportada");
});

test("prévia usa o texto, ou rótulo e legenda, e corta em 120", () => {
  assert.equal(previewOf({ type: "text", text: "Oi" }), "Oi");
  assert.equal(previewOf({ type: "image", text: "meu dente" }), "📷 Imagem — meu dente");
  assert.equal(previewOf({ type: "audio", text: null }), "🎤 Áudio");
  const long = previewOf({ type: "text", text: "a".repeat(300) });
  assert.equal(long.length, 120);
  assert.ok(long.endsWith("…"));
});

test("formato do contrato", () => {
  const at = new Date("2026-10-16T13:05:00Z");
  assert.deepEqual(
    presentConversation({
      id: "c1",
      phone: "5511999999999",
      name: "Maria",
      lastMessageAt: at,
      lastMessagePreview: "Oi",
      unreadCount: 2,
      assistantPaused: false,
      needsAttention: true,
      createdAt: at,
    }),
    {
      id: "c1",
      phone: "5511999999999",
      name: "Maria",
      lastMessageAt: "2026-10-16T13:05:00.000Z",
      lastMessagePreview: "Oi",
      unreadCount: 2,
      assistantPaused: false,
      needsAttention: true,
      optedOut: false,
    },
  );
  assert.deepEqual(
    presentMessage({
      id: "m1",
      conversationId: "c1",
      waMessageId: "W1",
      origin: "customer",
      type: "text",
      text: "Oi",
      status: "received",
      error: null,
      sentAt: at,
      createdAt: at,
    }),
    { id: "m1", origin: "customer", type: "text", text: "Oi", status: "received", error: null, sentAt: "2026-10-16T13:05:00.000Z" },
  );
});
