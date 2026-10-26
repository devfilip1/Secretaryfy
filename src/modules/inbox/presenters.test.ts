import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaLabel, presentConversation, presentMessage, previewOf } from "./presenters.js";

test("rótulos de mídia", () => {
  assert.equal(mediaLabel("text"), null);
  assert.equal(mediaLabel("audio"), "🎤 Audio");
  assert.equal(mediaLabel("image"), "📷 Image");
  assert.equal(mediaLabel("other"), "Unsupported message");
});

test("prévia usa o texto, ou rótulo e legenda, e corta em 120", () => {
  assert.equal(previewOf({ type: "text", text: "Oi" }), "Oi");
  assert.equal(previewOf({ type: "image", text: "meu dente" }), "📷 Image — meu dente");
  assert.equal(previewOf({ type: "audio", text: null }), "🎤 Audio");
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
      customerName: null,
      nameAskedAt: null,
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

test("o nome dito pelo cliente aparece no lugar do nome do perfil", () => {
  const at = new Date("2026-10-16T13:05:00Z");
  const row = {
    id: "c1",
    phone: "5511999999999",
    name: ".",
    lastMessageAt: at,
    lastMessagePreview: "Oi",
    unreadCount: 0,
    assistantPaused: false,
    needsAttention: false,
    customerName: null as string | null,
    nameAskedAt: null,
    createdAt: at,
  };
  assert.equal(presentConversation(row).name, ".");
  assert.equal(presentConversation({ ...row, customerName: "Maria" }).name, "Maria");
});
