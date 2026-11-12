import { DateTime } from "luxon";
import type { DayPeriod } from "../interpret.js";
import { dayPeriod } from "../replies.js";

/** Minuto do dia em que cada parte começa (a mesma divisão de dayPeriod, em replies.ts): cada parte é uma faixa de tempo */
const START_MINUTE: Record<DayPeriod, number> = { morning: 5 * 60, afternoon: 12 * 60, evening: 18 * 60 };

const minuteOfDay = (at: Date, tz: string) => {
  const t = DateTime.fromJSDate(at, { zone: tz });
  return t.hour * 60 + t.minute;
};

/** Os horários que caem na parte do dia pedida, na ordem em que vieram. */
export function slotsInPeriod(slots: Date[], period: DayPeriod, tz: string): Date[] {
  return slots.filter((s) => dayPeriod(DateTime.fromJSDate(s, { zone: tz }).hour) === period);
}

/**
 * Sem horário livre na parte pedida: os horários que vêm depois do início dela, do mais cedo (o mais próximo do que se pediu).
 * Se não há nenhum depois, os mais tarde do dia, que são os mais próximos antes dela. Devolve até `page` horários e se há mais.
 */
export function slotsNearPeriod(slots: Date[], period: DayPeriod, tz: string, page: number): { shown: Date[]; more: boolean } {
  const sorted = [...slots].sort((a, b) => a.getTime() - b.getTime());
  const later = sorted.filter((s) => minuteOfDay(s, tz) >= START_MINUTE[period]);
  if (later.length > 0) return { shown: later.slice(0, page), more: later.length > page };
  return { shown: sorted.slice(-page), more: sorted.length > page };
}
