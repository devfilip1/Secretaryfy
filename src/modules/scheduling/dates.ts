import { DateTime } from "luxon";

/** Língua das mensagens ao cliente (CLINIC_LANGUAGE). Os formatos mudam; a leitura aceita as duas línguas. */
export type Language = "en" | "pt";

/** Datas simples que o cliente escreve, resolvidas sem o modelo (contracts/interpreter.md §1). */

const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
  // Português, sem acento e sem "-feira" (normalize tira os dois)
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  domingo: 7,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9,
  outubro: 10, novembro: 11, dezembro: 12,
};

const ORDINAL = "(\\d{1,2})(?:st|nd|rd|th)?";
const MONTH_NAMES = Object.keys(MONTHS).join("|");
const WEEKDAY_NAMES = Object.keys(WEEKDAYS).join("|");
const DAY_MONTH = new RegExp(`^(?:dia )?${ORDINAL} (${MONTH_NAMES})$`);
const MONTH_DAY = new RegExp(`^(${MONTH_NAMES}) ${ORDINAL}$`);
const DAY_OF_MONTH = /^dia (\d{1,2})$/;
const NUMERIC = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/;
/** "próxima segunda", "next friday" */
const NEXT_WEEKDAY = /^(?:next|proxim[oa]) (.+)$/;

/** Tira acentos. */
const stripAccents = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "");

/** Minúsculas, sem acento, pontuação (menos a barra) e palavras de cortesia ou ligação ("de", "do"...). */
function normalize(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/ ]/gu, " ")
    .replace(/ feira\b/g, " ")
    .replace(/\b(please|pls|on|this|the|of|de)\b/g, " ")
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

/** "dia 25": o dia 25 deste mês, ou do próximo se já passou. */
function nextDayOfMonth(today: DateTime, day: number): DateTime | null {
  const candidate = DateTime.fromObject({ year: today.year, month: today.month, day }, { zone: today.zone });
  if (candidate.isValid && candidate >= today) return candidate;
  const next = today.plus({ months: 1 }).set({ day });
  return next.isValid && next.day === day ? next : null;
}

/**
 * Converte "today", "tomorrow", "friday", "next friday", "23/10", "Oct 23" e "23 Oct" (e "hoje", "amanhã", "depois de
 * amanhã", "sábado", "próxima terça", "dia 25", "25/11", "25 de novembro") em YYYY-MM-DD no fuso da clínica.
 * Devolve null para qualquer outra coisa: o resto fica com o modelo.
 */
export function parseSimpleDate(text: string, { now, timeZone }: { now: Date; timeZone: string }): string | null {
  const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  const t = normalize(text);
  let result: DateTime | null = null;
  let m: RegExpMatchArray | null;

  if (t === "today" || t === "hoje") result = today;
  else if (t === "tomorrow" || t === "amanha") result = today.plus({ days: 1 });
  else if (t === "depois amanha") result = today.plus({ days: 2 });
  else if (WEEKDAYS[t]) {
    // O próximo dia com esse nome, contando hoje
    result = today.plus({ days: (WEEKDAYS[t] - today.weekday + 7) % 7 });
  } else if ((m = t.match(NEXT_WEEKDAY)) && WEEKDAYS[m[1]]) {
    // Na semana seguinte (de segunda a domingo)
    const nextMonday = today.plus({ days: 8 - today.weekday });
    result = nextMonday.plus({ days: WEEKDAYS[m[1]] - 1 });
  } else if ((m = t.match(NUMERIC))) result = calendarDate(today, Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined);
  else if ((m = t.match(DAY_MONTH))) result = calendarDate(today, MONTHS[m[2]], Number(m[1]));
  else if ((m = t.match(MONTH_DAY))) result = calendarDate(today, MONTHS[m[1]], Number(m[2]));
  else if ((m = t.match(DAY_OF_MONTH))) result = nextDayOfMonth(today, Number(m[1]));

  return result ? result.toISODate() : null;
}

const DATE_IN_TEXT = new RegExp(
  [
    "\\b(?:today|tomorrow|hoje|amanha|depois amanha)\\b",
    `\\b(?:next |proxim[oa] )?(?:${WEEKDAY_NAMES})\\b`,
    "\\b\\d{1,2}/\\d{1,2}(?:/\\d{4})?\\b",
    "\\bdia \\d{1,2}\\b",
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

/**
 * Horário citado pelo cliente ("10 am", "2:30 pm", "14:00", "at 9am", "14h", "14h30", "às 10"), em minutos desde a
 * meia-noite.
 */
export function parseTimeOfDay(text: string): number | null {
  const t = stripAccents(text.toLowerCase()).replace(/\./g, "");
  const m =
    t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) ??
    t.match(/\b(\d{1,2}):(\d{2})\b/) ??
    t.match(/\b(\d{1,2})h(\d{2})?\b/) ??
    t.match(/\bas (\d{1,2})\b/);
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

/** "Wed, Oct 21" (en) ou "qua., 21 de out." (pt) no fuso da clínica (textos ao cliente). */
/** Nome do dia da semana por extenso ("Saturday", "sábado"). */
export function weekdayName(at: Date | string, timeZone: string, language: Language = "en"): string {
  const dt = toZoned(at, timeZone);
  return language === "pt" ? dt.setLocale("pt-BR").toFormat("cccc") : dt.setLocale("en-US").toFormat("cccc");
}

export function formatDay(at: Date | string, timeZone: string, language: Language = "en"): string {
  const dt = toZoned(at, timeZone);
  return language === "pt" ? dt.setLocale("pt-BR").toFormat("ccc, d 'de' LLL") : dt.setLocale("en-US").toFormat("ccc, LLL d");
}

/** "10:00 AM" (en) ou "10:00" (pt) no fuso da clínica. */
export function formatTime(at: Date, timeZone: string, language: Language = "en"): string {
  const dt = DateTime.fromJSDate(at, { zone: timeZone });
  return language === "pt" ? dt.toFormat("HH:mm") : dt.setLocale("en-US").toFormat("h:mm a");
}

/** "Wed, Oct 21 at 10:00 AM" (en) ou "qua., 21 de out. às 10:00" (pt). */
export function formatDayTime(at: Date, timeZone: string, language: Language = "en"): string {
  const connector = language === "pt" ? " às " : " at ";
  return `${formatDay(at, timeZone, language)}${connector}${formatTime(at, timeZone, language)}`;
}

/** Aceita um Date ou uma data YYYY-MM-DD (que já está no fuso da clínica). */
function toZoned(at: Date | string, timeZone: string): DateTime {
  return typeof at === "string" ? DateTime.fromISO(at, { zone: timeZone }) : DateTime.fromJSDate(at, { zone: timeZone });
}

/** Dia por extenso, como uma pessoa escreve: "quinta-feira, 5 de novembro" / "Thursday, November 5". */
export function formatDayLong(at: Date | string, timeZone: string, language: Language = "en"): string {
  const dt = toZoned(at, timeZone);
  return language === "pt" ? dt.setLocale("pt-BR").toFormat("cccc, d 'de' LLLL") : dt.setLocale("en-US").toFormat("cccc, LLLL d");
}

/** Dia por extenso e hora: "sexta-feira, 6 de novembro às 11:00". */
export function formatWhen(at: Date, timeZone: string, language: Language = "en"): string {
  return `${formatDayLong(at, timeZone, language)}${language === "pt" ? " às " : " at "}${formatTime(at, timeZone, language)}`;
}
