import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeClock } from "../../test/clock.js";
import { createDebouncer } from "./debounce.js";

function setup() {
  const clock = fakeClock();
  const fired: [string, string][] = [];
  const d = createDebouncer<string>({
    delayMs: 4000,
    onFire: (id, payload) => fired.push([id, payload]),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  return { clock, fired, d };
}

test("mensagens seguidas disparam uma vez, 4 s depois da última", async () => {
  const { clock, fired, d } = setup();
  d.push("c1", "oi");
  await clock.advance(1000);
  d.push("c1", "tudo bem?");
  await clock.advance(1000);
  d.push("c1", "queria marcar");
  await clock.advance(3999);
  assert.deepEqual(fired, []);
  await clock.advance(1);
  assert.deepEqual(fired, [["c1", "queria marcar"]]);
});

test("conversas diferentes têm temporizadores independentes", async () => {
  const { clock, fired, d } = setup();
  d.push("c1", "a");
  await clock.advance(2000);
  d.push("c2", "b");
  await clock.advance(2000);
  assert.deepEqual(fired, [["c1", "a"]]);
  await clock.advance(2000);
  assert.deepEqual(fired, [["c1", "a"], ["c2", "b"]]);
});

test("cancelar impede o disparo", async () => {
  const { clock, fired, d } = setup();
  d.push("c1", "a");
  d.cancel("c1");
  await clock.advance(10000);
  assert.deepEqual(fired, []);
  assert.equal(d.pending(), 0);
});
