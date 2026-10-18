import { DateTime } from "luxon";
import type { Interval } from "../google/gateway.js";
import type { Rules } from "./rules.js";

/** Cálculo dos horários livres a partir das regras e da ocupação da agenda (research.md R6). Sem rede. */

interface Context {
  rules: Rules;
  busy: Interval[];
  now: Date;
  timeZone: string;
}

/** Dias em que se pode marcar: de hoje até hoje + maxDaysAhead, e o intervalo para consultar a ocupação. */
export function bookingWindow({ rules, now, timeZone }: Pick<Context, "rules" | "now" | "timeZone">) {
  const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  const last = today.plus({ days: rules.maxDaysAhead });
  return {
    firstDate: today.toISODate()!,
    lastDate: last.toISODate()!,
    from: now,
    to: last.plus({ days: 1 }).toJSDate(),
  };
}

const overlaps = (start: Date, end: Date, busy: Interval[]) => busy.some((b) => b.start < end && b.end > start);

/**
 * Horários livres de um dia (YYYY-MM-DD no fuso da clínica): do início ao fim do atendimento, no passo da duração
 * (FR-009), depois da antecedência mínima e sem sobrepor nenhum intervalo ocupado (FR-010).
 */
export function slotsForDay(date: string, { rules, busy, now, timeZone }: Context): Date[] {
  const window = bookingWindow({ rules, now, timeZone });
  if (date < window.firstDate || date > window.lastDate) return [];

  const day = DateTime.fromISO(date, { zone: timeZone });
  const hours = rules.weeklyHours[String(day.weekday) as keyof Rules["weeklyHours"]];
  if (!day.isValid || !hours) return [];

  const open = DateTime.fromISO(`${date}T${hours.start}`, { zone: timeZone });
  const close = DateTime.fromISO(`${date}T${hours.end}`, { zone: timeZone });
  const earliest = now.getTime() + rules.minNoticeMinutes * 60_000;

  const slots: Date[] = [];
  // Passo em minutos absolutos: na troca de horário de verão nada se repete nem some
  for (let start = open; start.plus({ minutes: rules.slotMinutes }) <= close; start = start.plus({ minutes: rules.slotMinutes })) {
    const s = start.toJSDate();
    const e = start.plus({ minutes: rules.slotMinutes }).toJSDate();
    if (s.getTime() >= earliest && !overlaps(s, e, busy)) slots.push(s);
  }
  return slots;
}

/** Dias com ao menos um horário livre, em ordem, a partir de hoje (ou depois de `after`). */
export function availableDays(ctx: Context & { after?: string }): string[] {
  const window = bookingWindow(ctx);
  const days: string[] = [];
  for (let d = DateTime.fromISO(window.firstDate, { zone: ctx.timeZone }); d.toISODate()! <= window.lastDate; d = d.plus({ days: 1 })) {
    const date = d.toISODate()!;
    if (ctx.after && date <= ctx.after) continue;
    if (slotsForDay(date, ctx).length > 0) days.push(date);
  }
  return days;
}

/** O horário escolhido continua livre e dentro das regras? (FR-015) */
export function isSlotAvailable(start: Date, ctx: Context): boolean {
  const date = DateTime.fromJSDate(start, { zone: ctx.timeZone }).toISODate()!;
  return slotsForDay(date, ctx).some((s) => s.getTime() === start.getTime());
}
