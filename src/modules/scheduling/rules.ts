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
    start: z.string().regex(HHMM, "use o formato HH:mm"),
    end: z.string().regex(HHMM, "use o formato HH:mm"),
  })
  // Só compara quando os dois horários estão no formato certo; senão o erro de formato basta
  .refine((d) => !HHMM.test(d.start) || !HHMM.test(d.end) || minutesOf(d.start) < minutesOf(d.end), {
    message: "the end must be after the start",
    path: ["end"],
  });

/** Regras de atendimento (contracts/panel-api.md, PUT /api/calendar/rules). */
export const rulesSchema = z
  .object({
    weeklyHours: z
      .partialRecord(z.enum(DAYS), dayHours)
      .refine((w) => Object.keys(w).length > 0, "marque ao menos um dia de atendimento"),
    slotMinutes: z.number().int().min(15).max(240).multipleOf(5, "use a multiple of 5 minutes"),
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
        ctx.addIssue({ code: "custom", path: ["weeklyHours", day], message: "the day is shorter than one appointment" });
      }
    }
  });

export type Rules = { weeklyHours: WeeklyHours } & Omit<z.infer<typeof rulesSchema>, "weeklyHours">;

const WEEKDAY_HOURS = { start: "09:00", end: "18:00" };

/** Segunda a sexta, das 9h às 18h, consultas de 60 min (spec, Assumptions). */
export const DEFAULT_RULES: Rules = {
  weeklyHours: { "1": WEEKDAY_HOURS, "2": WEEKDAY_HOURS, "3": WEEKDAY_HOURS, "4": WEEKDAY_HOURS, "5": WEEKDAY_HOURS },
  slotMinutes: 60,
  minNoticeMinutes: 120,
  maxDaysAhead: 30,
  cancelNoticeMinutes: 1440,
};

function fromRow(row: SchedulingRulesRow): Rules {
  return {
    weeklyHours: row.weeklyHours,
    slotMinutes: row.slotMinutes,
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
