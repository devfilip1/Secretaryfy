import assert from "node:assert/strict";
import { test } from "node:test";
import { TEST_ANTIBAN as CONFIG } from "../../test/antiban.js";
import { assessConversation, type AssessedMessage } from "./assess.js";

const NOW = new Date("2026-10-18T12:00:00Z");

/** Monta um histórico: cada passo é [quem, segundos depois do anterior]. */
function history(steps: [AssessedMessage["origin"], number][], start = NOW.getTime() - 3_600_000): AssessedMessage[] {
  let at = start;
  return steps.map(([origin, seconds]) => {
    at += seconds * 1000;
    return { origin, status: origin === "customer" ? "received" : "sent", sentAt: new Date(at) };
  });
}

const exchanges = (n: number, replySeconds: number) =>
  Array.from({ length: n }, () => [["assistant", 30], ["customer", replySeconds]] as [AssessedMessage["origin"], number][]).flat();

test("conversa normal", () => {
  const messages = history([["customer", 0], ["assistant", 8], ["customer", 40], ["assistant", 9]]);
  assert.equal(assessConversation(messages, NOW, CONFIG), "ok");
});

test("3 respostas do assistente depois da última do cliente: insistência", () => {
  const messages = history([["customer", 0], ["assistant", 8], ["assistant", 60], ["assistant", 60]]);
  assert.equal(assessConversation(messages, NOW, CONFIG), "too_many_unanswered");
});

test("o contato responde sempre em menos de 3 s, 5 vezes seguidas: laço", () => {
  const messages = history([["customer", 0], ...exchanges(5, 1)]);
  assert.equal(assessConversation(messages, NOW, CONFIG), "loop");
});

test("uma resposta lenta no meio quebra a sequência rápida", () => {
  const steps = [...exchanges(2, 1), ["assistant", 30], ["customer", 10], ...exchanges(2, 1)] as [AssessedMessage["origin"], number][];
  assert.equal(assessConversation(history([["customer", 0], ...steps]), NOW, CONFIG), "ok");
});

test("20 respostas do assistente em 10 minutos: laço", () => {
  const steps = Array.from({ length: 20 }, () => [["customer", 10], ["assistant", 10]] as [AssessedMessage["origin"], number][]).flat();
  const messages = history(steps, NOW.getTime() - 9 * 60_000);
  assert.equal(assessConversation(messages, NOW, CONFIG), "loop");
});

test("mensagens bloqueadas não contam como insistência", () => {
  const messages = history([["customer", 0], ["assistant", 8], ["assistant", 60]]);
  messages.push({ origin: "assistant", status: "blocked", sentAt: NOW });
  assert.equal(assessConversation(messages, NOW, CONFIG), "ok");
});
