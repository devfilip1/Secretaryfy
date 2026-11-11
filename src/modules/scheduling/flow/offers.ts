import { DateTime } from "luxon";
import { availableDays, naturalSlotsForDay, slotsForDay } from "../availability.js";
import type { FlowResult } from "../flow.js";
import type { DayPeriod } from "../interpret.js";
import type { Rules } from "../rules.js";
import { dayPeriod } from "../replies.js";
import type { Run } from "./run.js";

/** Até 6 dias ou horários por resposta (FR-013). */
export const PAGE = 6;

// --- Oferta de dias e horários ---

/** Dias com vaga em toda a janela, numa consulta só à agenda. */
async function daysWithOpenings(run: Run, after?: string): Promise<string[]> {
  const busy = await run.calendar.busy(run.window.from, run.window.to);
  return availableDays({ ...run.ctx(busy), after });
}

/** Todos os inícios livres do dia, na grade: servem para conferir o horário que o cliente pediu. */
async function slotsOn(run: Run, date: string): Promise<Date[]> {
  const start = DateTime.fromISO(date, { zone: run.tz });
  const busy = await run.calendar.busy(start.toJSDate(), start.plus({ days: 1 }).toJSDate());
  return slotsForDay(date, run.ctx(busy));
}

/** Os horários que se oferecem ao cliente: só os naturais, sem buracos (ADR 0015). */
async function offerableOn(run: Run, date: string): Promise<Date[]> {
  const start = DateTime.fromISO(date, { zone: run.tz });
  const busy = await run.calendar.busy(start.toJSDate(), start.plus({ days: 1 }).toJSDate());
  return naturalSlotsForDay(date, run.ctx(busy));
}

async function saveDays(run: Run, days: string[]) {
  await run.save({ step: "choose_day", options: days.map((date, i) => ({ n: i + 1, kind: "day" as const, date })) });
}

export async function offerDays(run: Run, { after }: { after?: string } = {}): Promise<FlowResult> {
  const days = (await daysWithOpenings(run, after)).slice(0, PAGE);
  if (days.length === 0) return run.finish(run.replies.noOpenings());
  await saveDays(run, days);
  return { reply: run.replies.offerDays(days, run.tz) };
}

/** Horários de um dia (ou só os de uma parte dele); sem vaga, os dias livres mais próximos (US2, cenário 3). */
export async function offerDay(run: Run, date: string, period: DayPeriod | null = null): Promise<FlowResult> {
  if (date > run.window.lastDate) return tooFar(run);
  const slots = await offerableOn(run, date);
  if (slots.length === 0) {
    const closest = await closestDays(run, date);
    if (closest.length === 0) return run.finish(run.replies.noOpenings());
    await saveDays(run, closest);
    // Dia sem atendimento nas regras semanais: avisa que está fechado, em vez de "sem horários"
    const isClosed = (weekday: number) => !run.rules.weeklyHours[String(weekday) as keyof Rules["weeklyHours"]];
    if (!isClosed(DateTime.fromISO(date, { zone: run.tz }).weekday)) return { reply: run.replies.dayFull(date, closest, run.tz) };
    const closedWeekdays = [1, 2, 3, 4, 5, 6, 7].filter(isClosed);
    return { reply: run.replies.closedDay(closedWeekdays, closest, run.tz) };
  }
  if (period) return offerPeriod(run, date, slots, period);
  return offerSlots(run, date, slots);
}

/** Só os horários da parte do dia pedida; sem nenhum, avisa e oferece os outros horários do mesmo dia. */
async function offerPeriod(run: Run, date: string, slots: Date[], period: DayPeriod): Promise<FlowResult> {
  const inPeriod = slots.filter((s) => dayPeriod(DateTime.fromJSDate(s, { zone: run.tz }).hour) === period);
  if (inPeriod.length > 0) return offerSlots(run, date, inPeriod);
  const page = slots.slice(0, PAGE);
  await saveSlots(run, page);
  return { reply: run.replies.periodEmpty(date, period, page, run.tz, slots.length > PAGE) };
}

/** Os horários da tela são do dia que está nela: pedir "de tarde" é a tarde desse dia. */
export async function periodOfScreen(run: Run, period: DayPeriod): Promise<FlowResult> {
  const slots = run.optionSlots(run.session!.options);
  return offerDay(run, run.isoDate(slots[0]), period);
}

function saveSlots(run: Run, page: Date[]) {
  return run.save({ step: "choose_slot", options: page.map((s, i) => ({ n: i + 1, kind: "slot" as const, start: s.toISOString() })) });
}

/** Primeira página de horários do dia; "taken" quando o horário escolhido acabou de ser ocupado. */
async function offerSlots(run: Run, date: string, slots: Date[], kind: "offer" | "taken" = "offer"): Promise<FlowResult> {
  const page = slots.slice(0, PAGE);
  await saveSlots(run, page);
  const reply =
    kind === "taken" ? run.replies.slotTaken(date, page, run.tz) : run.replies.offerSlots(date, page, run.tz, slots.length > PAGE);
  return { reply };
}

/** O cliente nomeou o dia que já está na tela: o que ele quer é um horário, e ele não está entre as opções. */
export function sameDayAsOptions(run: Run, date: string): boolean {
  const slots = run.optionSlots(run.session!.options);
  return slots.length > 0 && run.isoDate(slots[0]) === date;
}

export async function timeNotOffered(run: Run): Promise<FlowResult> {
  const slots = run.optionSlots(run.session!.options);
  return { reply: run.replies.slotNotOffered(run.isoDate(slots[0]), slots, run.tz) };
}

export async function moreSlots(run: Run): Promise<FlowResult> {
  const last = run.optionSlots(run.session!.options).at(-1)!;
  const date = run.isoDate(last);
  const rest = (await offerableOn(run, date)).filter((s) => s > last);
  if (rest.length === 0) {
    const days = (await daysWithOpenings(run, date)).slice(0, PAGE);
    if (days.length === 0) return run.finish(run.replies.noOpenings());
    await saveDays(run, days);
    return { reply: run.replies.offerDays(days, run.tz, run.replies.noMoreOpeningsToday()) };
  }
  return offerSlots(run, date, rest);
}

async function closestDays(run: Run, date: string): Promise<string[]> {
  const target = DateTime.fromISO(date, { zone: run.tz });
  const distance = (d: string) => Math.abs(DateTime.fromISO(d, { zone: run.tz }).diff(target, "days").days);
  return (await daysWithOpenings(run))
    .sort((a, b) => distance(a) - distance(b) || a.localeCompare(b))
    .slice(0, PAGE)
    .sort();
}

export async function tooFar(run: Run): Promise<FlowResult> {
  const days = (await daysWithOpenings(run)).slice(0, PAGE);
  if (days.length === 0) return run.finish(run.replies.noOpenings());
  await saveDays(run, days);
  return { reply: run.replies.tooFar(run.rules.maxDaysAhead, run.window.lastDate, days, run.tz) };
}

/** Dia com horário citado: confere o horário (ele vale mais que a parte do dia); sem horário, oferece os do dia. */
export function offerDayOrTime(run: Run, date: string, time: string | null, period: DayPeriod | null): Promise<FlowResult> {
  return time ? askedTime(run, date, time) : offerDay(run, date, period);
}

/** O cliente citou um horário: livre na grade, vale; ocupado ou fora da grade, avisa e oferece os mais próximos do dia. */
export async function askedTime(run: Run, date: string, time: string): Promise<FlowResult> {
  if (date > run.window.lastDate) return tooFar(run);
  const slots = await slotsOn(run, date);
  if (slots.length === 0) return offerDay(run, date);
  const wanted = DateTime.fromISO(`${date}T${time}`, { zone: run.tz }).toMillis();
  const exact = slots.find((s) => s.getTime() === wanted);
  if (exact) return selectSlot(run, exact);
  const nearest = [...slots]
    .sort((a, b) => Math.abs(a.getTime() - wanted) - Math.abs(b.getTime() - wanted))
    .slice(0, 3)
    .sort((a, b) => a.getTime() - b.getTime());
  await run.save({ step: "choose_slot", options: nearest.map((s, i) => ({ n: i + 1, kind: "slot" as const, start: s.toISOString() })) });
  return { reply: run.replies.slotNotOffered(date, nearest, run.tz) };
}

/** O horário foi tomado entre a oferta e o "sim": novas opções no mesmo dia, ou os dias mais próximos. */
export async function slotTaken(run: Run, start: Date): Promise<FlowResult> {
  const date = run.isoDate(start);
  const slots = await offerableOn(run, date);
  if (slots.length > 0) return offerSlots(run, date, slots, "taken");
  return offerDay(run, date);
}

// selectSlot, toSummary e confirmBooking moram aqui (e não em booking.ts) porque askedTime os usa:
// booking.ts importa este arquivo, então o contrário criaria um ciclo de importação.

export async function selectSlot(run: Run, start: Date): Promise<FlowResult> {
  // Pelo fluxo da própria vez: um horário citado na primeira mensagem de remarcação ainda não tem sessão salva
  if (run.carry.flow === "reschedule") {
    const appt = run.carry.appointmentId ? await run.store.findAppointment(run.carry.appointmentId) : null;
    if (!appt) return run.finish(run.replies.noAppointment());
    await run.save({ step: "confirm_reschedule", selectedStart: start });
    return { reply: run.replies.confirmReschedule(appt.startsAt, start, run.tz) };
  }
  const name = run.session?.customerName ?? run.knownName;
  if (!name) {
    await run.save({ step: "ask_name", selectedStart: start });
    return { reply: run.replies.askName() };
  }
  return toSummary(run, start, name);
}

/** Com nome e horário: pergunta o serviço se ele ainda não veio da conversa, senão mostra o resumo (FR-011). */
export async function toSummary(run: Run, start: Date, name: string): Promise<FlowResult> {
  if (run.carry.service) return confirmBooking(run, start, name);
  const options = run.catalog.list().map((s, i) => ({ n: i + 1, kind: "service" as const, service: s.name }));
  await run.save({ step: "choose_service", options, selectedStart: start, customerName: name });
  return { reply: run.replies.chooseService(name) };
}

export async function confirmBooking(run: Run, start: Date, name: string): Promise<FlowResult> {
  await run.save({ step: "confirm_booking", selectedStart: start, customerName: name });
  return { reply: run.replies.confirmBooking(start, run.minutes, name, run.carry.service!, run.tz) };
}
