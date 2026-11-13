import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { fakeClock, flush } from "../../test/clock.js";
import { createBursts } from "./burst.js";

const LOG = { error: () => undefined } as unknown as FastifyBaseLogger;
const QUIET_MS = 3000;

/** Cliente que escreve, e um atendimento falso: cada rodada responde tudo o que estava sem resposta. */
function setup({ slow = false } = {}) {
  const clock = fakeClock();
  const unanswered: string[] = [];
  const runs: { text: string; waited: boolean }[] = [];
  const finishers: (() => void)[] = [];
  let active = 0;
  let maxActive = 0;

  const bursts = createBursts({
    quietMs: QUIET_MS,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    unanswered: async () => {
      if (unanswered.length === 0) return null;
      return { kind: "message", id: "M", phone: "5511", fromMe: false, type: "text", text: unanswered.join("\n"), sentAt: new Date() };
    },
    handle: async ({ message }, _log, { waited }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const count = message.text!.split("\n").length;
      runs.push({ text: message.text!, waited });
      if (slow) await new Promise<void>((resolve) => finishers.push(resolve));
      unanswered.splice(0, count);
      active--;
    },
  });

  const say = (text: string) => {
    unanswered.push(text);
    bursts.push("c1", LOG);
  };
  return { clock, runs, finishers, maxActive: () => maxActive, say, bursts };
}

test("duas mensagens com 1 s de intervalo: uma rodada, uma resposta com as duas", async () => {
  const { clock, runs, say } = setup();
  say("Oi");
  await clock.advance(1000);
  say("Queria marcar uma consulta");
  await clock.advance(QUIET_MS - 1);
  assert.deepEqual(runs, []);
  await clock.advance(1);
  assert.deepEqual(runs, [{ text: "Oi\nQueria marcar uma consulta", waited: false }]);
});

test("duas mensagens com 10 s de intervalo: duas rodadas, na ordem", async () => {
  const { clock, runs, say } = setup();
  say("Oi");
  await clock.advance(10_000);
  say("Queria marcar");
  await clock.advance(10_000);
  assert.deepEqual(runs, [
    { text: "Oi", waited: false },
    { text: "Queria marcar", waited: false },
  ]);
});

test("mensagem que chega durante uma rodada: espera a rodada terminar e vem depois, na ordem", async () => {
  const { clock, runs, finishers, maxActive, say } = setup({ slow: true });
  say("Oi");
  await clock.advance(QUIET_MS);
  assert.equal(runs.length, 1);

  say("Queria marcar");
  await clock.advance(QUIET_MS);
  assert.equal(runs.length, 1, "a segunda rodada não começa enquanto a primeira não termina");

  finishers.shift()!();
  await flush();
  assert.deepEqual(runs.map((r) => [r.text, r.waited]), [
    ["Oi", false],
    ["Queria marcar", true],
  ]);

  finishers.shift()!();
  await flush();
  assert.equal(maxActive(), 1);
});

test("cancelar a rodada pendente impede a resposta", async () => {
  const { clock, runs, say, bursts } = setup();
  say("Oi");
  bursts.cancel("c1");
  await clock.advance(10_000);
  assert.deepEqual(runs, []);
});
