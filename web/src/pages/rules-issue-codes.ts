import type { RulesIssueCode } from "@server/modules/scheduling/rules";

/**
 * Códigos dos problemas das regras de atendimento. Espelha RULES_ISSUE_CODES em src/modules/scheduling/rules.ts: o array
 * não pode ser importado (o módulo puxa zod e o banco). A checagem abaixo quebra o typecheck se as listas divergirem.
 * Sem import de React, para o teste rodar em node puro.
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

type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Só vale `true` se esta lista tiver exatamente os códigos do servidor (RulesIssueCode). */
export const RULES_ISSUE_CODES_MATCH_SERVER: SameMembers<RulesIssueCode, (typeof RULES_ISSUE_CODES)[number]> = true;
