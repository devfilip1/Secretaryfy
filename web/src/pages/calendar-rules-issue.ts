import type { RulesIssue } from "../api";

/** Campos de prazo: o servidor manda min e max em minutos, e o painel edita esses campos em horas. */
const HOUR_FIELDS = ["minNoticeMinutes", "cancelNoticeMinutes"];
const MINUTES_PER_HOUR = 60;

/**
 * Parâmetros do texto de erro de uma regra. Nos campos de prazo, min e max viram horas (a unidade do campo); os outros
 * campos seguem como o servidor mandou.
 */
export function issueParamsForPanel(issue: RulesIssue): Record<string, unknown> {
  const params = issue.params ?? {};
  if (!HOUR_FIELDS.some((field) => issue.path.endsWith(field))) return params;
  return {
    ...params,
    ...(typeof params.min === "number" ? { min: params.min / MINUTES_PER_HOUR } : {}),
    ...(typeof params.max === "number" ? { max: params.max / MINUTES_PER_HOUR } : {}),
  };
}
