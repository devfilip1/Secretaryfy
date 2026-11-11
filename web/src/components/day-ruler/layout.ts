import type { DayKey } from "../../api";

// Régua do dia (topo de Conversas): cálculo puro, sem React. Recebe os agendamentos de hoje e devolve posições em % da régua.

/** Distância mínima entre dois pinos da mesma faixa, em % da régua (~15 px numa régua de ~330 px). */
const PIN_GAP_PCT = 4.5;
/** Marcas a cada 2 horas, nas horas pares do relógio da clínica. */
const TICK_MINUTES = 120;

const ISO_WEEKDAY: Record<string, DayKey> = { Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6", Sun: "7" };

export interface OpeningHours {
  /** "HH:MM" no fuso da clínica */
  start: string;
  end: string;
}

export interface RulerAppointment {
  id: string;
  startsAt: string;
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

export interface Pin {
  id: string;
  startsAt: string;
  startMinutes: number;
  /** Entre 0 e 100; consulta fora do horário fica na borda */
  leftPct: number;
  /** 0 sobre a linha; 1 abaixo dela, quando o vizinho ficaria em cima */
  lane: 0 | 1;
  status: PinStatus;
  customerName: string;
  service: string | null;
}

export interface DayLayout {
  open: boolean;
  startMinutes: number;
  endMinutes: number;
  ticks: { minutes: number; leftPct: number }[];
  pins: Pin[];
  /** null quando a hora atual está fora do horário de funcionamento */
  nowPct: number | null;
  count: number;
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
  const nowMinutes = minutesOfDay(input.now, timeZone);
  const sorted = input.appointments
    .map((appointment) => ({ appointment, startMinutes: minutesOfDay(new Date(appointment.startsAt), timeZone) }))
    .sort((a, b) => a.startMinutes - b.startMinutes);
  const upcoming = sorted.find((item) => item.startMinutes > nowMinutes);
  const next = upcoming
    ? {
        id: upcoming.appointment.id,
        startsAt: upcoming.appointment.startsAt,
        startMinutes: upcoming.startMinutes,
        customerName: upcoming.appointment.customerName,
      }
    : null;
  const count = input.appointments.length;

  const start = input.hours ? toMinutes(input.hours.start) : 0;
  const end = input.hours ? toMinutes(input.hours.end) : 0;
  if (!input.hours || end <= start) {
    return { open: false, startMinutes: 0, endMinutes: 0, ticks: [], pins: [], nowPct: null, count, next: null };
  }

  const pctOf = (minutes: number) => clamp(((minutes - start) / (end - start)) * 100, 0, 100);
  const pins = assignLanes(
    sorted.map(({ appointment, startMinutes }) => ({
      id: appointment.id,
      startsAt: appointment.startsAt,
      startMinutes,
      leftPct: pctOf(startMinutes),
      status: statusOf(appointment, input.attentionPhones),
      customerName: appointment.customerName,
      service: appointment.service,
    })),
  );
  // Dia longo (mais de 10 h) usa marcas de 4 em 4 horas para os rótulos não se sobreporem
  const step = end - start > 600 ? 240 : TICK_MINUTES;
  const ticks: DayLayout["ticks"] = [];
  for (let minutes = Math.ceil(start / step) * step; minutes <= end; minutes += step) {
    ticks.push({ minutes, leftPct: pctOf(minutes) });
  }
  const inside = nowMinutes >= start && nowMinutes <= end;
  return {
    open: true,
    startMinutes: start,
    endMinutes: end,
    ticks,
    pins,
    nowPct: inside ? pctOf(nowMinutes) : null,
    count,
    next,
  };
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
 * Pinos vizinhos dentro de PIN_GAP_PCT vão para a faixa de baixo. ponytail: com três pinos colados, o terceiro
 * fica em cima do primeiro; para um dia de clínica basta, sem empilhar mais faixas.
 */
function assignLanes(pins: Omit<Pin, "lane">[]): Pin[] {
  const lastLeft: [number, number] = [-Infinity, -Infinity];
  return pins.map((pin) => {
    const fits = (lane: 0 | 1) => lastLeft[lane] + PIN_GAP_PCT <= pin.leftPct;
    const lane: 0 | 1 = fits(0) ? 0 : fits(1) ? 1 : 0;
    lastLeft[lane] = pin.leftPct;
    return { ...pin, lane };
  });
}
