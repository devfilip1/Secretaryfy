import assert from "node:assert/strict";
import { test } from "node:test";
import { TEST_ANTIBAN as CONFIG } from "../../test/antiban.js";
import { fakeClock } from "../../test/clock.js";
import { createBreaker, type BreakerState } from "./breaker.js";

function setup() {
  const clock = fakeClock();
  let row: { pausedUntil: Date | null; reason: BreakerState["reason"] } | null = null;
  const changes: BreakerState[] = [];
  const breaker = createBreaker({
    repo: {
      getProtectionState: async () => (row ? { id: 1, updatedAt: clock.now(), ...row } : null),
      setPaused: async (pausedUntil, reason) => {
        row = { pausedUntil, reason };
      },
    },
    config: CONFIG,
    now: clock.now,
    onChange: (s) => changes.push(s),
  });
  return { clock, breaker, changes };
}

test("5 falhas em 10 minutos pausam por 30 minutos e avisam uma vez", async () => {
  const { clock, breaker, changes } = setup();
  for (let i = 0; i < 5; i++) {
    await breaker.recordFailure();
    await clock.advance(60_000);
  }
  const state = await breaker.current();
  assert.equal(state.paused, true);
  assert.equal(state.reason, "send_failures");
  assert.equal(changes.length, 1);
  await breaker.recordFailure();
  assert.equal(changes.length, 1);
});

test("4 falhas não pausam, nem 5 espalhadas além da janela", async () => {
  const { clock, breaker } = setup();
  for (let i = 0; i < 4; i++) await breaker.recordFailure();
  assert.equal((await breaker.current()).paused, false);
  await clock.advance(11 * 60_000);
  await breaker.recordFailure();
  assert.equal((await breaker.current()).paused, false);
});

test("3 quedas de conexão em 30 minutos pausam", async () => {
  const { clock, breaker } = setup();
  for (let i = 0; i < 3; i++) {
    await breaker.recordDrop();
    await clock.advance(5 * 60_000);
  }
  assert.equal((await breaker.current()).reason, "connection_drops");
});

test("depois do prazo a pausa termina sozinha e avisa", async () => {
  const { clock, breaker, changes } = setup();
  for (let i = 0; i < 5; i++) await breaker.recordFailure();
  await clock.advance(CONFIG.breakerPauseMs + 1);
  assert.deepEqual(await breaker.current(), { paused: false, pausedUntil: null, reason: null });
  assert.equal(changes.at(-1)?.paused, false);
});
