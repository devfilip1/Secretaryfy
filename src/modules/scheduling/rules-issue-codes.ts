/**
 * Códigos dos problemas das regras de atendimento. Sem dependências (nada de zod nem de banco), para o painel
 * importar esta lista pelo alias @server. O painel traduz cada um em `rules.issue.<código>`.
 */
export const RULES_ISSUE_CODES = [
  "no_open_day",
  "end_before_start",
  "day_shorter_than_appointment",
  "invalid_format",
  "invalid_type",
  "too_small",
  "too_big",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid",
] as const;

export type RulesIssueCode = (typeof RULES_ISSUE_CODES)[number];
