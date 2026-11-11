import assert from "node:assert/strict";
import { test } from "node:test";
import { issueParamsForPanel } from "./calendar-rules-issue";

test("prazo mínimo em minutos vira horas, a unidade do campo", () => {
  const issue = { path: "minNoticeMinutes", code: "too_small", message: "", params: { min: 120 } };
  assert.deepEqual(issueParamsForPanel(issue), { min: 2 });
});

test("prazo de cancelamento: máximo em minutos vira horas", () => {
  const issue = { path: "cancelNoticeMinutes", code: "too_big", message: "", params: { max: 10080 } };
  assert.deepEqual(issueParamsForPanel(issue), { max: 168 });
});

test("outros campos mantêm os parâmetros como vieram", () => {
  const issue = { path: "maxDaysAhead", code: "too_big", message: "", params: { max: 90 } };
  assert.deepEqual(issueParamsForPanel(issue), { max: 90 });
});

test("sem parâmetros, volta vazio", () => {
  const issue = { path: "slotMinutes", code: "invalid_type", message: "" };
  assert.deepEqual(issueParamsForPanel(issue), {});
});
