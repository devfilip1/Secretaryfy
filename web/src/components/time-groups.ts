// Agrupa os inícios do dia em manhã, tarde e noite (no fuso da clínica) para o seletor de horários do painel.
export type DayPart = "Morning" | "Afternoon" | "Evening";

const PARTS: DayPart[] = ["Morning", "Afternoon", "Evening"];

export function dayPart(iso: string, timeZone: string | undefined): DayPart {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(iso)),
  );
  return hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
}

/** Só as partes do dia que têm horários, na ordem do dia */
export function groupByDayPart<T>(items: T[], iso: (item: T) => string, timeZone: string | undefined): { part: DayPart; items: T[] }[] {
  return PARTS.map((part) => ({ part, items: items.filter((i) => dayPart(iso(i), timeZone) === part) })).filter((g) => g.items.length > 0);
}

/** Durações rápidas que cabem no espaço livre */
export function durationPresets(maxMinutes: number): number[] {
  return [15, 30, 45, 60, 90].filter((m) => m <= maxMinutes);
}
