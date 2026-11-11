/**
 * Códigos dos problemas das regras de atendimento. Espelha RULES_ISSUE_CODES em src/modules/scheduling/rules.ts:
 * ao mudar um, mude o outro. Sem import de React, para o teste rodar em node puro.
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
