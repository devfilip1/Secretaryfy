import assert from "node:assert/strict";
import { test } from "node:test";
import { createOllamaClient, type ChatMessage } from "./ollama.js";

/** Ollama falso: guarda o corpo enviado ao /api/chat e responde uma mensagem vazia. */
function clienteComCorpoCapturado(model: string) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ message: { role: "assistant", content: "{}" } }));
  }) as typeof globalThis.fetch;
  const client = createOllamaClient({ url: "http://ollama.test", model, timeoutMs: 1000, fetch });
  const messages: ChatMessage[] = [{ role: "user", content: "oi" }];
  return { chat: () => client.chat({ messages, format: {} }), bodies };
}

test("qwen3 desliga o pensamento com think false no corpo", async () => {
  const { chat, bodies } = clienteComCorpoCapturado("qwen3:8b");
  await chat();
  assert.equal(bodies[0].think, false);
});

test("qwen3:4b também desliga o pensamento", async () => {
  const { chat, bodies } = clienteComCorpoCapturado("qwen3:4b");
  await chat();
  assert.equal(bodies[0].think, false);
});

test("llama3 manda o corpo sem a chave think", async () => {
  const { chat, bodies } = clienteComCorpoCapturado("llama3");
  await chat();
  assert.equal("think" in bodies[0], false);
});
