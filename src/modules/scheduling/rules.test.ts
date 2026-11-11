import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES, RULES_ISSUE_CODES, rulesIssueView, rulesSchema, type Rules, type RulesIssueCode } from "./rules.js";

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

// Cada caso gera um problema; o código e os parâmetros são o que o painel traduz.
const CODE_CASES: { rules: unknown; path: string; code: RulesIssueCode; params: Record<string, unknown> }[] = [
  { rules: withRules({ weeklyHours: { "1": { start: "18:00", end: "09:00" } } }), path: "weeklyHours.1.end", code: "end_before_start", params: {} },
  { rules: withRules({ weeklyHours: { "1": { start: "9:00", end: "18:00" } } }), path: "weeklyHours.1.start", code: "invalid_format", params: {} },
  { rules: withRules({ weeklyHours: {} }), path: "weeklyHours", code: "no_open_day", params: {} },
  { rules: withRules({ slotMinutes: 120, weeklyHours: { "6": { start: "09:00", end: "10:00" } } }), path: "weeklyHours.6", code: "day_shorter_than_appointment", params: { minutes: 120 } },
  { rules: withRules({ slotMinutes: 10 }), path: "slotMinutes", code: "too_small", params: { min: 15 } },
  { rules: withRules({ slotMinutes: 17 }), path: "slotMinutes", code: "not_multiple_of", params: { divisor: 5 } },
  { rules: withRules({ slotMinutes: 60.5 }), path: "slotMinutes", code: "invalid_type", params: {} },
  { rules: withRules({ minNoticeMinutes: 20000 }), path: "minNoticeMinutes", code: "too_big", params: { max: 10080 } },
  { rules: withRules({ cancelNoticeMinutes: -1 }), path: "cancelNoticeMinutes", code: "too_small", params: { min: 0 } },
  { rules: withRules({ weeklyHours: { "8": { start: "09:00", end: "18:00" } } }), path: "weeklyHours", code: "unrecognized_keys", params: {} },
];

test("todo problema das regras sai com um código da lista fixa, com os parâmetros que o painel usa", () => {
  const produced = new Set<string>();
  for (const { rules, path, code, params } of CODE_CASES) {
    const views = (rulesSchema.safeParse(rules).error?.issues ?? []).map(rulesIssueView);
    const found = views.find((v) => v.path === path);
    assert.ok(found, `sem problema em ${path}`);
    assert.equal(found.code, code);
    assert.deepEqual(found.params, params);
    assert.ok(found.message.length > 0, "a mensagem em inglês fica como fallback");
    assert.ok((RULES_ISSUE_CODES as readonly string[]).includes(found.code), `código fora da lista: ${found.code}`);
    produced.add(found.code);
  }
  // Tudo da lista sai dos casos, exceto "invalid", o fallback para o que o zod não mapeia
  assert.deepEqual(
    [...produced].sort(),
    RULES_ISSUE_CODES.filter((c) => c !== "invalid").sort(),
  );
});
