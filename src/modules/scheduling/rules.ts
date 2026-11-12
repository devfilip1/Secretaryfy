import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "../../db/schema.js";
import { schedulingRules, type SchedulingRulesRow, type WeeklyHours } from "../../db/schema.js";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

const dayHours = z
  .object({
    start: z.string().regex(HHMM, "use the HH:mm format"),
    end: z.string().regex(HHMM, "use the HH:mm format"),
  })
  // Só compara quando os dois horários estão no formato certo; senão o erro de formato basta
  .refine((d) => !HHMM.test(d.start) || !HHMM.test(d.end) || minutesOf(d.start) < minutesOf(d.end), {
    message: "the end must be after the start",
    path: ["end"],
    params: { code: "end_before_start" },
  });

/** Duração de um atendimento em minutos: de 15 a 240, de 5 em 5 (também vale para avaliação e retorno na identidade da clínica) */
export const appointmentMinutes = z.number().int().min(15).max(240).multipleOf(5);

/** Regras de atendimento (contracts/panel-api.md, PUT /api/calendar/rules). */
export const rulesSchema = z
  .object({
    weeklyHours: z
      .partialRecord(z.enum(DAYS), dayHours)
      .refine((w) => Object.keys(w).length > 0, {
        message: "mark at least one day of business hours",
        params: { code: "no_open_day" },
      }),
    /** Duração padrão de um atendimento (o de cada tratamento pode ser outro, ADR 0015) */
    slotMinutes: appointmentMinutes,
    /** De quantos em quantos minutos pode começar um atendimento */
    gridMinutes: z.number().int().min(5).max(60).multipleOf(5),
    minNoticeMinutes: z.number().int().min(0).max(10080),
    maxDaysAhead: z.number().int().min(1).max(180),
    cancelNoticeMinutes: z.number().int().min(0).max(10080),
  })
  .superRefine((rules, ctx) => {
    for (const [day, hours] of Object.entries(rules.weeklyHours)) {
      if (!hours) continue;
      const window = minutesOf(hours.end) - minutesOf(hours.start);
      // Janela invertida já tem o seu erro no campo "end"
      if (window > 0 && window < rules.slotMinutes) {
        ctx.addIssue({
          code: "custom",
          path: ["weeklyHours", day],
          message: "the day is shorter than one appointment",
          params: { code: "day_shorter_than_appointment", minutes: rules.slotMinutes },
        });
      }
    }
  });

/** Códigos dos problemas das regras. O painel traduz cada um em `rules.issue.<código>`; web/src/pages/rules-issue-codes.ts espelha esta lista. */
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

/** Problema como vai na resposta 422 `invalid_rules`. `message` é o texto em inglês, usado como fallback. */
export interface RulesIssueView {
  path: string;
  message: string;
  code: RulesIssueCode;
  params: Record<string, unknown>;
}

const view = (code: RulesIssueCode, issue: z.core.$ZodIssue, params: Record<string, unknown> = {}): RulesIssueView => ({
  path: issue.path.map(String).join("."),
  message: issue.message,
  code,
  params,
});

/** Código e parâmetros de cada problema: os próprios do zod viram códigos estáveis; o resto cai em "invalid". */
export function rulesIssueView(issue: z.core.$ZodIssue): RulesIssueView {
  switch (issue.code) {
    case "custom": {
      const { code = "invalid", ...params } = issue.params ?? {};
      return view(code as RulesIssueCode, issue, params);
    }
    case "too_small":
      return view("too_small", issue, { min: issue.minimum });
    case "too_big":
      return view("too_big", issue, { max: issue.maximum });
    case "not_multiple_of":
      return view("not_multiple_of", issue, { divisor: issue.divisor });
    case "invalid_format":
      // As regras só têm texto no formato HH:mm
      return view("invalid_format", issue);
    case "invalid_type":
      return view("invalid_type", issue);
    case "unrecognized_keys":
      return view("unrecognized_keys", issue);
    default:
      return view("invalid", issue);
  }
}

export type Rules = { weeklyHours: WeeklyHours } & Omit<z.infer<typeof rulesSchema>, "weeklyHours">;

const WEEKDAY_HOURS = { start: "09:00", end: "18:00" };

/** Segunda a sexta, das 9h às 18h, consultas de 60 min (spec, Assumptions). */
export const DEFAULT_RULES: Rules = {
  weeklyHours: { "1": WEEKDAY_HOURS, "2": WEEKDAY_HOURS, "3": WEEKDAY_HOURS, "4": WEEKDAY_HOURS, "5": WEEKDAY_HOURS },
  slotMinutes: 60,
  gridMinutes: 15,
  minNoticeMinutes: 120,
  maxDaysAhead: 30,
  cancelNoticeMinutes: 1440,
};

function fromRow(row: SchedulingRulesRow): Rules {
  return {
    weeklyHours: row.weeklyHours,
    slotMinutes: row.slotMinutes,
    gridMinutes: row.gridMinutes,
    minNoticeMinutes: row.minNoticeMinutes,
    maxDaysAhead: row.maxDaysAhead,
    cancelNoticeMinutes: row.cancelNoticeMinutes,
  };
}

export function createRulesStore(db: Db) {
  return {
    /** As regras salvas, ou os padrões (gravados na primeira leitura). */
    async get(): Promise<Rules> {
      const [row] = await db.select().from(schedulingRules).where(eq(schedulingRules.id, 1));
      if (row) return fromRow(row);
      const [created] = await db.insert(schedulingRules).values(DEFAULT_RULES).onConflictDoNothing().returning();
      return created ? fromRow(created) : this.get();
    },

    /** Grava regras já validadas por `rulesSchema`. */
    async save(rules: Rules): Promise<Rules> {
      const values = { ...rules, updatedAt: new Date() };
      const [row] = await db
        .insert(schedulingRules)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: schedulingRules.id, set: values })
        .returning();
      return fromRow(row);
    },
  };
}

export type RulesStore = ReturnType<typeof createRulesStore>;
