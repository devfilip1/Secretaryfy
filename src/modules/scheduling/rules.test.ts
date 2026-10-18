import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES, rulesSchema, type Rules } from "./rules.js";

function issuesOf(rules: unknown): string[] {
  const parsed = rulesSchema.safeParse(rules);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join("."));
}

const withRules = (patch: Partial<Rules>): Rules => ({ ...DEFAULT_RULES, ...patch });

test("os padrões são válidos: segunda a sexta, 9h às 18h, 60 min", () => {
  assert.deepEqual(issuesOf(DEFAULT_RULES), []);
  assert.deepEqual(Object.keys(DEFAULT_RULES.weeklyHours), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(DEFAULT_RULES.weeklyHours["1"], { start: "09:00", end: "18:00" });
  assert.equal(DEFAULT_RULES.slotMinutes, 60);
  assert.equal(DEFAULT_RULES.minNoticeMinutes, 120);
  assert.equal(DEFAULT_RULES.maxDaysAhead, 30);
  assert.equal(DEFAULT_RULES.cancelNoticeMinutes, 1440);
});

test("início depois do fim é recusado no campo do dia", () => {
  assert.deepEqual(issuesOf(withRules({ weeklyHours: { "1": { start: "18:00", end: "09:00" } } })), ["weeklyHours.1.end"]);
  assert.deepEqual(issuesOf(withRules({ weeklyHours: { "1": { start: "9:00", end: "18:00" } } })), ["weeklyHours.1.start"]);
});

test("duração precisa ser múltiplo de 5, entre 15 e 240, e caber na janela de cada dia", () => {
  assert.deepEqual(issuesOf(withRules({ slotMinutes: 10 })), ["slotMinutes"]);
  assert.deepEqual(issuesOf(withRules({ slotMinutes: 17 })), ["slotMinutes"]);
  assert.deepEqual(
    issuesOf(withRules({ slotMinutes: 120, weeklyHours: { "6": { start: "09:00", end: "10:00" } } })),
    ["weeklyHours.6"],
  );
});

test("dias da semana: ao menos um, e só de 1 a 7", () => {
  assert.deepEqual(issuesOf(withRules({ weeklyHours: {} })), ["weeklyHours"]);
  assert.ok(issuesOf(withRules({ weeklyHours: { "8": { start: "09:00", end: "18:00" } } })).length > 0);
});

test("limites de antecedência, dias à frente e prazo de cancelamento", () => {
  assert.deepEqual(issuesOf(withRules({ maxDaysAhead: 0 })), ["maxDaysAhead"]);
  assert.deepEqual(issuesOf(withRules({ cancelNoticeMinutes: -1 })), ["cancelNoticeMinutes"]);
  assert.deepEqual(issuesOf(withRules({ minNoticeMinutes: 20000 })), ["minNoticeMinutes"]);
  assert.deepEqual(issuesOf(withRules({ minNoticeMinutes: 0, cancelNoticeMinutes: 0 })), []);
});
