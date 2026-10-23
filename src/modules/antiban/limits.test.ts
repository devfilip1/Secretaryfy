import assert from "node:assert/strict";
import { test } from "node:test";
import { TEST_ANTIBAN as CONFIG } from "../../test/antiban.js";
import { warmupLimits } from "./limits.js";

const START = new Date("2026-10-01T12:00:00Z");
const days = (n: number) => new Date(START.getTime() + n * 24 * 60 * 60 * 1000);

test("aquecimento: começa nos limites reduzidos", () => {
  const l = warmupLimits(CONFIG, START, START);
  assert.deepEqual(l, { perMinute: 4, perHour: 100, conversationsPerDay: 30, warmupUntil: days(14) });
});

test("aquecimento: no meio do período, a meio caminho", () => {
  const l = warmupLimits(CONFIG, START, days(7));
  assert.equal(l.perMinute, 6);
  assert.equal(l.perHour, 150);
  assert.equal(l.conversationsPerDay, 90);
});

test("aquecimento: ao fim do período valem os normais", () => {
  assert.deepEqual(warmupLimits(CONFIG, START, days(14)), { perMinute: 8, perHour: 200, conversationsPerDay: 150, warmupUntil: null });
});

test("sem aquecimento (0 dias) ou número desconhecido valem os normais", () => {
  assert.equal(warmupLimits({ ...CONFIG, warmupDays: 0 }, START, START).conversationsPerDay, 150);
  assert.equal(warmupLimits(CONFIG, null, START).warmupUntil, null);
});
