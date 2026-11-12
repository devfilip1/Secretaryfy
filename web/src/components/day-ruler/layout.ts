import type { DayKey } from "../../api";

// Régua do dia (topo de Conversas): cálculo puro, sem React. Recebe os agendamentos de hoje e devolve posições em % da régua.

/** Espaço mínimo ocupado por um bloco, em % da régua (~17 px numa régua de ~340 px): a consulta curta continua clicável. */
const MIN_SPAN_PCT = 5;
/** Folga visual entre dois blocos seguidos, em % da régua (~2 px). Tira-se da largura; o início não se move. */
export const BLOCK_GAP_PCT = 0.6;
/** Marcas a cada 2 horas, nas horas pares do relógio da clínica. */
const TICK_MINUTES = 120;
/** Rótulo de uma marca some quando fica mais perto que isso do marcador de agora (o horário atual já aparece). */
const NOW_LABEL_CLEARANCE_PCT = 12;
/** Tolerância para comparar posições em ponto flutuante (blocos seguidos encostam exatamente). */
const EPSILON_PCT = 1e-9;
const MINUTE_MS = 60_000;

const ISO_WEEKDAY: Record<string, DayKey> = { Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6", Sun: "7" };

export interface OpeningHours {
  /** "HH:MM" no fuso da clínica */
  start: string;
  end: string;
}

export interface RulerAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  service: string | null;
  phone: string;
  confirmedAt: string | null;
}

export interface RulerInput {
  /** Só os agendamentos de hoje (o chamador filtra pelo dia da clínica) */
  appointments: RulerAppointment[];
  /** Horário de funcionamento de hoje; null quando o dia está fechado */
  hours: OpeningHours | null;
  now: Date;
  /** undefined = fuso do navegador, como o Intl */
  timeZone: string | undefined;
  /** Telefones de conversas que precisam da equipe */
  attentionPhones: ReadonlySet<string>;
}

export type PinStatus = "confirmed" | "waiting" | "needs_team";

/** Bloco de uma consulta na régua (o nome Pin é herdado de quando era um ponto). */
export interface Pin {
  id: string;
  startsAt: string;
  startMinutes: number;
  durationMinutes: number;
  /** Início do bloco em % da régua; o bloco nunca sai da régua */
  leftPct: number;
  /** Largura desenhada em %: a duração, com mínimo, menos a folga entre blocos */
  widthPct: number;
  /** 0 centralizado na linha; 1, 2... em faixas abaixo, quando a consulta se sobrepõe à da faixa de cima */
  lane: number;
  status: PinStatus;
  customerName: string;
  service: string | null;
  /** Começou antes de agora */
  passed: boolean;
  /** Começou antes de agora e ainda não terminou */
  inProgress: boolean;
}

export interface Tick {
  minutes: number;
  leftPct: number;
  /** false quando o rótulo colidiria com o marcador de agora */
  labelShown: boolean;
}

export interface DayLayout {
  open: boolean;
  startMinutes: number;
  endMinutes: number;
  ticks: Tick[];
  pins: Pin[];
  /** Faixas usadas pelos blocos (mínimo 1): a régua só cresce quando há sobreposição */
  lanes: number;
  /** null quando a hora atual está fora do horário de funcionamento */
  nowPct: number | null;
  /** Parte da linha do dia já percorrida: 0 antes da abertura, 100 depois do fechamento */
  progressPct: number;
  /** Consultas do dia: total, as que já começaram (done) e as que ainda não (left) */
  count: number;
  done: number;
  left: number;
  /** Primeira consulta que ainda não começou */
  next: { id: string; startsAt: string; startMinutes: number; customerName: string } | null;
}

/** Minutos desde a meia-noite no relógio do fuso dado. */
export function minutesOfDay(date: Date, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  const valueOf = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return valueOf("hour") * 60 + valueOf("minute");
}

/** AAAA-MM-DD do dia no fuso dado: dois instantes são o mesmo dia se a chave for igual. */
export function dayKeyOf(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Dia da semana no formato do horário de funcionamento: "1" é segunda e "7" é domingo. */
export function weekdayKeyOf(date: Date, timeZone: string | undefined): DayKey {
  return ISO_WEEKDAY[new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date)];
}

/** Hora do relógio de um minuto do dia, no idioma dado (a régua não depende do fuso do navegador). */
export function clockLabel(minutes: number, locale: string): string {
  const at = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "2-digit", minute: "2-digit" }).format(at);
}

export function layoutDay(input: RulerInput): DayLayout {
  const { timeZone } = input;
  const nowMs = input.now.getTime();
  const nowMinutes = minutesOfDay(input.now, timeZone);
  const sorted = input.appointments
    .map((appointment) => {
      const startsMs = new Date(appointment.startsAt).getTime();
      const endsMs = new Date(appointment.endsAt).getTime();
      // Quem começa agora já começou: sai da "próxima", como antes
      return {
        appointment,
        startMinutes: minutesOfDay(new Date(startsMs), timeZone),
        durationMinutes: durationOf(startsMs, endsMs),
        passed: startsMs <= nowMs,
        inProgress: startsMs <= nowMs && nowMs < endsMs,
      };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes);
  const upcoming = sorted.find((item) => !item.passed);
  const next = upcoming
    ? {
        id: upcoming.appointment.id,
        startsAt: upcoming.appointment.startsAt,
        startMinutes: upcoming.startMinutes,
        customerName: upcoming.appointment.customerName,
      }
    : null;
  const count = input.appointments.length;
  const done = sorted.filter((item) => item.passed).length;
  const left = count - done;

  const start = input.hours ? toMinutes(input.hours.start) : 0;
  const end = input.hours ? toMinutes(input.hours.end) : 0;
  if (!input.hours || end <= start) {
    return { open: false, startMinutes: 0, endMinutes: 0, ticks: [], pins: [], lanes: 1, nowPct: null, progressPct: 0, count, done, left, next: null };
  }

  const pctOf = (minutes: number) => clamp(((minutes - start) / (end - start)) * 100, 0, 100);
  const spans = sorted.map(({ startMinutes, durationMinutes }) => {
    const startPct = pctOf(startMinutes);
    const spanPct = clamp(Math.max(pctOf(startMinutes + durationMinutes) - startPct, MIN_SPAN_PCT), 0, 100);
    return { leftPct: Math.min(startPct, 100 - spanPct), spanPct };
  });
  const laneOf = assignLanes(spans);
  const pins: Pin[] = sorted.map(({ appointment, startMinutes, durationMinutes, passed, inProgress }, index) => ({
    id: appointment.id,
    startsAt: appointment.startsAt,
    startMinutes,
    durationMinutes,
    leftPct: spans[index].leftPct,
    widthPct: Math.max(spans[index].spanPct - BLOCK_GAP_PCT, 0),
    lane: laneOf[index],
    status: statusOf(appointment, input.attentionPhones),
    customerName: appointment.customerName,
    service: appointment.service,
    passed,
    inProgress,
  }));
  const inside = nowMinutes >= start && nowMinutes <= end;
  const nowPct = inside ? pctOf(nowMinutes) : null;
  // Dia longo (mais de 10 h) usa marcas de 4 em 4 horas para os rótulos não se sobreporem
  const step = end - start > 600 ? 240 : TICK_MINUTES;
  const ticks: Tick[] = [];
  for (let minutes = Math.ceil(start / step) * step; minutes <= end; minutes += step) {
    const leftPct = pctOf(minutes);
    const labelShown = nowPct === null || Math.abs(leftPct - nowPct) >= NOW_LABEL_CLEARANCE_PCT;
    ticks.push({ minutes, leftPct, labelShown });
  }
  return {
    open: true,
    startMinutes: start,
    endMinutes: end,
    ticks,
    pins,
    lanes: Math.max(1, ...laneOf.map((lane) => lane + 1)),
    nowPct,
    progressPct: pctOf(nowMinutes),
    count,
    done,
    left,
    next,
  };
}

/** Duração em minutos entre início e fim; dado inválido vira 0 (o bloco fica com a largura mínima). */
function durationOf(startsMs: number, endsMs: number): number {
  const minutes = (endsMs - startsMs) / MINUTE_MS;
  return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Problema que precisa da equipe ganha da confirmação: é o que mais importa ver. */
function statusOf(appointment: RulerAppointment, attentionPhones: ReadonlySet<string>): PinStatus {
  if (attentionPhones.has(appointment.phone)) return "needs_team";
  return appointment.confirmedAt ? "confirmed" : "waiting";
}

/**
 * Faixa de cada bloco, pela sobreposição do trecho ocupado (início até início + largura mínima).
 * Blocos seguidos (um termina onde o outro começa) ficam na mesma faixa. Só um bloco que se sobrepõe a outro
 * vai para a faixa de baixo; a primeira faixa livre é a escolhida. Os blocos chegam ordenados pelo início.
 */
function assignLanes(spans: { leftPct: number; spanPct: number }[]): number[] {
  const laneEnds: number[] = [];
  return spans.map(({ leftPct, spanPct }) => {
    let lane = laneEnds.findIndex((end) => end <= leftPct + EPSILON_PCT);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = leftPct + spanPct;
    return lane;
  });
}
