import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeClock, flush } from "../../test/clock.js";
import { createSendQueue, type QueueOutcome } from "./queue.js";

function setup(slotFreeAt = 0) {
  const clock = fakeClock();
  const ran: string[] = [];
  let active = 0;
  let maxActive = 0;
  const queue = createSendQueue({
    now: clock.now,
    // Uma vaga a cada `slotFreeAt` ms
    waitForSlot: (deadline) =>
      new Promise((resolve) => {
        if (clock.now().getTime() + slotFreeAt > deadline.getTime()) return resolve(false);
        if (slotFreeAt === 0) return resolve(true);
        clock.setTimeout(() => resolve(true), slotFreeAt);
      }),
  });
  const job = (name: string, ttl = 60_000) =>
    queue.enqueue({
      expiresAt: new Date(clock.now().getTime() + ttl),
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        ran.push(name);
        active--;
        return name;
      },
    });
  return { clock, queue, ran, job, maxActive: () => maxActive };
}

test("envia na ordem de chegada, um de cada vez", async () => {
  const s = setup(1000);
  const results = Promise.all([s.job("a"), s.job("b"), s.job("c")]);
  for (let i = 0; i < 5; i++) await s.clock.advance(1000);
  assert.deepEqual(await results, [
    { ok: true, value: "a" },
    { ok: true, value: "b" },
    { ok: true, value: "c" },
  ]);
  assert.deepEqual(s.ran, ["a", "b", "c"]);
  assert.equal(s.maxActive(), 1);
});

test("a mensagem que expira esperando vaga não sai (rate_limited)", async () => {
  const s = setup(10_000);
  const first = s.job("a", 60_000);
  const second = s.job("b", 15_000);
  await s.clock.advance(60_000);
  assert.deepEqual(await first, { ok: true, value: "a" });
  assert.deepEqual(await second, { ok: false, reason: "rate_limited" });
  assert.deepEqual(s.ran, ["a"]);
});

test("a verificação na saída pode impedir o envio", async () => {
  const s = setup();
  const out = await s.queue.enqueue({ expiresAt: new Date(Date.now() + 1e9), check: async () => "superseded", run: async () => "x" });
  assert.deepEqual(out, { ok: false, reason: "superseded" });
});

test("drain resolve tudo o que espera, sem enviar", async () => {
  const s = setup(1000);
  const results = [s.job("a"), s.job("b"), s.job("c")];
  await flush();
  s.queue.drain("paused");
  await s.clock.advance(5000);
  const outcomes: QueueOutcome<string>[] = await Promise.all(results);
  assert.deepEqual(outcomes.slice(1), [
    { ok: false, reason: "paused" },
    { ok: false, reason: "paused" },
  ]);
  assert.equal(s.queue.size(), 0);
});

test("erro no envio rejeita só aquela mensagem", async () => {
  const s = setup();
  const failing = s.queue.enqueue({ expiresAt: new Date(Date.now() + 1e9), run: async () => Promise.reject(new Error("down")) });
  const rejected = assert.rejects(failing, /down/);
  const next = s.job("b");
  await s.clock.advance(1000);
  await rejected;
  assert.deepEqual(await next, { ok: true, value: "b" });
});
