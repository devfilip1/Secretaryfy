import type { WeeklyHours } from "../../db/schema.js";
import { weekdayNames, type Language } from "../scheduling/dates.js";
import { HOURS_TEXT } from "./texts.js";

/** Dias seguidos com o mesmo horário (ou todos fechados): `key` compara, `value` é o texto. */
interface Span {
  first: number;
  last: number;
  key: string | null;
  value: string;
}

/**
 * Linhas do horário de atendimento, geradas das regras semanais (BR-KNO-02): dias seguidos com o mesmo horário viram
 * uma linha, de segunda a domingo. O horário não é guardado no conhecimento; sai sempre das regras.
 */
export function hoursLines(weeklyHours: WeeklyHours, language: Language): string[] {
  const texts = HOURS_TEXT[language];
  const names = weekdayNames(language).map((name) => name.charAt(0).toUpperCase() + name.slice(1));
  const spans: Span[] = [];
  for (let day = 1; day <= 7; day++) {
    const hours = weeklyHours[`${day}` as keyof WeeklyHours];
    const key = hours ? `${hours.start}-${hours.end}` : null;
    const value = hours ? texts.timeRange(hours.start, hours.end) : texts.closed;
    const previous = spans.at(-1);
    if (previous && previous.key === key && previous.last === day - 1) previous.last = day;
    else spans.push({ first: day, last: day, key, value });
  }
  return spans.map(({ first, last, value }) => {
    const label = first === last ? names[first - 1] : texts.dayRange(names[first - 1], names[last - 1]);
    return `${label}: ${value}`;
  });
}
