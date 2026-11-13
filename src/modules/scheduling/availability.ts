import { DateTime } from "luxon";
import type { Interval } from "../google/gateway.js";
import type { Rules } from "./rules.js";

/** Cálculo dos horários livres a partir das regras e da ocupação da agenda (research.md R6). Sem rede. */

interface Context {
  rules: Rules;
  busy: Interval[];
  now: Date;
  timeZone: string;
  /** Duração do atendimento; sem ela vale `rules.slotMinutes` (ADR 0015) */
  minutes?: number;
  /** Janela em dias; sem ele vale `rules.maxDaysAhead` */
  maxDaysAhead?: number;
}

/** A equipe marca até um ano à frente (painel, para quem liga); o paciente, só dentro de `maxDaysAhead`. */
export const STAFF_MAX_DAYS_AHEAD = 365;

/** Dias em que se pode marcar: de hoje até hoje + maxDaysAhead, e o intervalo para consultar a ocupação. */
export function bookingWindow({ rules, now, timeZone, maxDaysAhead }: Pick<Context, "rules" | "now" | "timeZone" | "maxDaysAhead">) {
  const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  const last = today.plus({ days: maxDaysAhead ?? rules.maxDaysAhead });
  return {
    firstDate: today.toISODate()!,
    lastDate: last.toISODate()!,
    from: now,
    to: last.plus({ days: 1 }).toJSDate(),
  };
}

const overlaps = (start: Date, end: Date, busy: Interval[]) => busy.some((b) => b.start < end && b.end > start);

/**
 * Horários livres de um dia (YYYY-MM-DD no fuso da clínica): inícios na grade das regras (`gridMinutes`) em que o
 * atendimento cabe no horário de funcionamento (FR-009), depois da antecedência mínima e sem sobrepor nenhum
 * intervalo ocupado (FR-010).
 */
export function slotsForDay(date: string, { rules, busy, now, timeZone, minutes, maxDaysAhead }: Context): Date[] {
  const length = minutes ?? rules.slotMinutes;
  const window = bookingWindow({ rules, now, timeZone, maxDaysAhead });
  if (date < window.firstDate || date > window.lastDate) return [];

  const day = DateTime.fromISO(date, { zone: timeZone });
  const hours = rules.weeklyHours[String(day.weekday) as keyof Rules["weeklyHours"]];
  if (!day.isValid || !hours) return [];

  const open = DateTime.fromISO(`${date}T${hours.start}`, { zone: timeZone });
  const close = DateTime.fromISO(`${date}T${hours.end}`, { zone: timeZone });
  const earliest = now.getTime() + rules.minNoticeMinutes * 60_000;

  const slots: Date[] = [];
  // Passo em minutos absolutos: na troca de horário de verão nada se repete nem some
  for (let start = open; start.plus({ minutes: length }) <= close; start = start.plus({ minutes: rules.gridMinutes })) {
    const s = start.toJSDate();
    const e = start.plus({ minutes: length }).toJSDate();
    if (s.getTime() >= earliest && !overlaps(s, e, busy)) slots.push(s);
  }
  return slots;
}

/**
 * Os horários "naturais" do dia, os que se oferecem ao cliente (ADR 0015): o primeiro do dia, o que começa quando um
 * atendimento acaba, o que termina quando outro começa e os que seguem a duração do tratamento desde a abertura. Assim
 * a oferta não deixa buracos que ninguém consegue usar. Sem nenhum natural, valem todos os livres.
 */
export function naturalSlotsForDay(date: string, ctx: Context): Date[] {
  const all = slotsForDay(date, ctx);
  if (all.length === 0) return all;
  const { rules, busy, timeZone } = ctx;
  const length = (ctx.minutes ?? rules.slotMinutes) * 60_000;
  const day = DateTime.fromISO(date, { zone: timeZone });
  const hours = rules.weeklyHours[String(day.weekday) as keyof Rules["weeklyHours"]]!;
  const open = DateTime.fromISO(`${date}T${hours.start}`, { zone: timeZone }).toMillis();
  const close = DateTime.fromISO(`${date}T${hours.end}`, { zone: timeZone }).toMillis();
  const natural = all.filter((s, i) => {
    const start = s.getTime();
    const end = start + length;
    return (
      i === 0 ||
      (start - open) % length === 0 ||
      end === close ||
      busy.some((b) => b.end.getTime() === start || b.start.getTime() === end)
    );
  });
  return natural.length > 0 ? natural : all;
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

/** Estado de um dia aberto na agenda: livre (há horário) ou lotado (a agenda ocupada tira todos os horários). */
export type DayStatus = "free" | "full";

/**
 * Estado de cada dia aberto do intervalo que se pode marcar (o do `ctx`). Fora do mapa, o dia está fechado ou sem
 * horário só por causa da antecedência mínima ou da hora que já passou: não é dia lotado.
 */
export function dayStatuses(ctx: Context): Record<string, DayStatus> {
  const window = bookingWindow(ctx);
  const status: Record<string, DayStatus> = {};
  for (let d = DateTime.fromISO(window.firstDate, { zone: ctx.timeZone }); d.toISODate()! <= window.lastDate; d = d.plus({ days: 1 })) {
    const date = d.toISODate()!;
    if (slotsForDay(date, ctx).length > 0) status[date] = "free";
    // Com a agenda vazia o dia teria horários: a ocupação é que os tirou
    else if (slotsForDay(date, { ...ctx, busy: [] }).length > 0) status[date] = "full";
  }
  return status;
}

/** O horário escolhido continua livre e dentro das regras? (FR-015) */
export function isSlotAvailable(start: Date, ctx: Context): boolean {
  const date = DateTime.fromJSDate(start, { zone: ctx.timeZone }).toISODate()!;
  return slotsForDay(date, ctx).some((s) => s.getTime() === start.getTime());
}

/** A ocupação sem o próprio horário de um agendamento que se edita: ele não conta contra a edição. */
export function busyWithout(busy: Interval[], own: { startsAt: Date; endsAt: Date }): Interval[] {
  return busy.filter((i) => i.start.getTime() !== own.startsAt.getTime() || i.end.getTime() !== own.endsAt.getTime());
}

/** Duração máxima que a equipe pode dar a um horário (painel, ADR 0015): nunca mais que isto. */
export const MAX_APPOINTMENT_MINUTES = 480;
/** A duração escolhida pela equipe anda de 5 em 5 minutos, e o mínimo é um passo. */
export const MINUTES_STEP = 5;

/**
 * Os inícios livres do dia, cada um com quanto a equipe pode dar a ele: até o início do próximo horário ocupado, até o
 * fechamento do dia e no máximo `MAX_APPOINTMENT_MINUTES`, arredondado para baixo a múltiplos de `MINUTES_STEP`.
 * Um início é livre se cabe pelo menos um passo (a mesma regra de `slotsForDay`, com a duração de um passo).
 */
export function startsWithRoom(date: string, ctx: Context): { start: Date; maxMinutes: number }[] {
  const { rules, busy, timeZone } = ctx;
  const day = DateTime.fromISO(date, { zone: timeZone });
  const hours = rules.weeklyHours[String(day.weekday) as keyof Rules["weeklyHours"]];
  if (!day.isValid || !hours) return [];
  const closeMs = DateTime.fromISO(`${date}T${hours.end}`, { zone: timeZone }).toMillis();

  return slotsForDay(date, { ...ctx, minutes: MINUTES_STEP }).map((start) => {
    const fromMs = start.getTime();
    // Só o próximo horário ocupado que começa depois deste início limita a duração
    const nextBusyMs = busy.reduce((first, b) => (b.start.getTime() >= fromMs && b.start.getTime() < first ? b.start.getTime() : first), Infinity);
    const untilMs = Math.min(nextBusyMs, closeMs, fromMs + MAX_APPOINTMENT_MINUTES * 60_000);
    const steps = Math.floor((untilMs - fromMs) / 60_000 / MINUTES_STEP);
    return { start, maxMinutes: steps * MINUTES_STEP };
  });
}
