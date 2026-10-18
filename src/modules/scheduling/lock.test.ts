import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { withCalendarLock } from "./lock.js";

test("chamadas simultâneas rodam uma depois da outra", async () => {
  const log: string[] = [];
  const task = (name: string, ms: number) =>
    withCalendarLock(async () => {
      log.push(`${name} começa`);
      await sleep(ms);
      log.push(`${name} termina`);
      return name;
    });

  const results = await Promise.all([task("a", 20), task("b", 1)]);
  assert.deepEqual(results, ["a", "b"]);
  assert.deepEqual(log, ["a começa", "a termina", "b começa", "b termina"]);
});

test("um erro na primeira não trava a segunda", async () => {
  const first = withCalendarLock(async () => {
    throw new Error("falhou");
  });
  const second = withCalendarLock(async () => "ok");
  await assert.rejects(first, /falhou/);
  assert.equal(await second, "ok");
});
