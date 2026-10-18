import { DateTime } from "luxon";

/** Datas simples que o cliente escreve, resolvidas sem o modelo (contracts/interpreter.md §1). */

const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

const ORDINAL = "(\\d{1,2})(?:st|nd|rd|th)?";
const MONTH_NAMES = Object.keys(MONTHS).join("|");
const DAY_MONTH = new RegExp(`^${ORDINAL} (${MONTH_NAMES})$`);
const MONTH_DAY = new RegExp(`^(${MONTH_NAMES}) ${ORDINAL}$`);
const NUMERIC = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/;

/** Tira pontuação (menos a barra), palavras de cortesia e espaços repetidos. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/ ]/gu, " ")
    .replace(/\b(please|pls|on|this|the|of)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Data no fuso, sem passar para o mês seguinte (31/02 é inválida). Datas sem ano vão para o próximo ano se já passaram. */
function calendarDate(today: DateTime, month: number, day: number, year?: number): DateTime | null {
  const candidate = DateTime.fromObject({ year: year ?? today.year, month, day }, { zone: today.zone });
  if (!candidate.isValid) return null;
  if (candidate < today) {
    if (year !== undefined) return null;
    const next = candidate.plus({ years: 1 });
    return next.isValid && next.day === day ? next : null;
  }
  return candidate;
}

/**
 * Converte "today", "tomorrow", "friday", "next friday", "23/10", "Oct 23" e "23 Oct" em YYYY-MM-DD no fuso da clínica.
 * Devolve null para qualquer outra coisa: o resto fica com o modelo.
 */
export function parseSimpleDate(text: string, { now, timeZone }: { now: Date; timeZone: string }): string | null {
  const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  const t = normalize(text);
  let result: DateTime | null = null;

  if (t === "today") result = today;
  else if (t === "tomorrow") result = today.plus({ days: 1 });
  else if (WEEKDAYS[t]) {
    // O próximo dia com esse nome, contando hoje
    result = today.plus({ days: (WEEKDAYS[t] - today.weekday + 7) % 7 });
  } else if (t.startsWith("next ") && WEEKDAYS[t.slice(5)]) {
    // Na semana seguinte (de segunda a domingo)
    const nextMonday = today.plus({ days: 8 - today.weekday });
    result = nextMonday.plus({ days: WEEKDAYS[t.slice(5)] - 1 });
  } else {
    let m: RegExpMatchArray | null;
    if ((m = t.match(NUMERIC))) result = calendarDate(today, Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined);
    else if ((m = t.match(DAY_MONTH))) result = calendarDate(today, MONTHS[m[2]], Number(m[1]));
    else if ((m = t.match(MONTH_DAY))) result = calendarDate(today, MONTHS[m[1]], Number(m[2]));
  }

  return result ? result.toISODate() : null;
}

const DATE_IN_TEXT = new RegExp(
  [
    "\\b(?:today|tomorrow)\\b",
    `\\b(?:next )?(?:${Object.keys(WEEKDAYS).join("|")})\\b`,
    "\\b\\d{1,2}/\\d{1,2}(?:/\\d{4})?\\b",
    `\\b(?:${MONTH_NAMES}) ${ORDINAL}\\b`,
    `\\b${ORDINAL} (?:${MONTH_NAMES})\\b`,
  ].join("|"),
  "g",
);

/**
 * Datas simples citadas no meio de uma frase ("do you have openings on Sunday?"). Devolve as datas distintas
 * encontradas: com exatamente uma, ela vale mais que a data calculada pelo modelo (contracts/interpreter.md §3).
 */
export function findDatesInText(text: string, ctx: { now: Date; timeZone: string }): string[] {
  const found = new Set<string>();
  for (const match of normalize(text).match(DATE_IN_TEXT) ?? []) {
    const date = parseSimpleDate(match, ctx);
    if (date) found.add(date);
  }
  return [...found];
}

/** Horário citado pelo cliente ("10 am", "2:30 pm", "14:00", "at 9am"), em minutos desde a meia-noite. */
export function parseTimeOfDay(text: string): number | null {
  const t = text.toLowerCase().replace(/\./g, "");
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) ?? t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2] ?? 0);
  const meridiem = m[3];
  if (minutes > 59 || hours > 23 || (meridiem && (hours < 1 || hours > 12))) return null;
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** Minutos desde a meia-noite de um instante, no fuso da clínica. */
export function minutesOfDay(at: Date, timeZone: string): number {
  const dt = DateTime.fromJSDate(at, { zone: timeZone });
  return dt.hour * 60 + dt.minute;
}

/** "Wed, Oct 21" no fuso da clínica (textos ao cliente). */
export function formatDay(at: Date | string, timeZone: string): string {
  return toZoned(at, timeZone).setLocale("en-US").toFormat("ccc, LLL d");
}

/** "10:00 AM" no fuso da clínica. */
export function formatTime(at: Date, timeZone: string): string {
  return DateTime.fromJSDate(at, { zone: timeZone }).setLocale("en-US").toFormat("h:mm a");
}

/** "Wed, Oct 21 at 10:00 AM". */
export function formatDayTime(at: Date, timeZone: string): string {
  return `${formatDay(at, timeZone)} at ${formatTime(at, timeZone)}`;
}

/** "qua, 21/10 às 10:00" (registros no painel). */
export function formatPtBr(at: Date, timeZone: string): string {
  const dt = DateTime.fromJSDate(at, { zone: timeZone }).setLocale("pt-BR");
  return `${dt.toFormat("ccc").replace(/\.$/, "")}, ${dt.toFormat("dd/LL 'às' HH:mm")}`;
}

/** Aceita um Date ou uma data YYYY-MM-DD (que já está no fuso da clínica). */
function toZoned(at: Date | string, timeZone: string): DateTime {
  return typeof at === "string" ? DateTime.fromISO(at, { zone: timeZone }) : DateTime.fromJSDate(at, { zone: timeZone });
}
