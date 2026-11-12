import { isSlotAvailable } from "../availability.js";
import { ASSESSMENT } from "../catalog.js";
import type { FlowResult } from "../flow.js";
import type { DayPeriod } from "../interpret.js";
import { CalendarUnavailable } from "../../google/gateway.js";
import { currentAppointment, offerReschedule, startReschedule } from "./appointment.js";
import { askedTime, confirmBooking, offerDay, offerDays, offerWeekend, slotTaken, toSummary } from "./offers.js";
import type { Run } from "./run.js";

export async function startBook(run: Run, date: string | null, time: string | null, period: DayPeriod | null, weekend = false): Promise<FlowResult> {
  const existing = await currentAppointment(run);
  // Com dia citado, ele (e o horário ou a parte do dia) vale para a remarcação, sem perguntar de novo (BR-SCH-05)
  if (existing) return date ? startReschedule(run, date, time, period) : offerReschedule(run, existing);
  run.carry = { flow: "book", appointmentId: null, customerName: run.carry.customerName, service: run.carry.service };
  // O tempo do atendimento decide quais inícios estão livres: o tratamento vem antes dos dias (ADR 0015)
  if (!run.carry.service) return askService(run);
  run.minutes = await run.lengthFor();
  if (date && time) return askedTime(run, date, time);
  if (weekend && !date) return offerWeekend(run);
  return date ? offerDay(run, date, period) : offerDays(run);
}

async function askService(run: Run): Promise<FlowResult> {
  const options = run.catalog.list().map((s, i) => ({ n: i + 1, kind: "service" as const, service: s.name }));
  await run.save({ step: "choose_service", options });
  return { reply: run.replies.chooseService(run.knownName) };
}

/** O cliente disse o nome no agendamento: vale também para a conversa (specs/005 FR-003). */
export async function nameGiven(run: Run, start: Date, name: string): Promise<FlowResult> {
  await run.inbox.setCustomerName(run.conversation.id, name);
  return toSummary(run, start, name);
}

export async function serviceChosen(run: Run, service: string): Promise<FlowResult> {
  const s = run.session!;
  run.carry = { ...run.carry, service };
  run.minutes = run.catalog.minutes(service) ?? run.rules.slotMinutes;
  // Perguntado antes dos dias: agora há como oferecê-los
  if (!s.selectedStart) return offerDays(run);
  // Trocado no resumo: o tempo novo precisa caber no horário escolhido
  const end = new Date(s.selectedStart.getTime() + run.minutes * 60_000);
  const busy = await run.calendar.busy(s.selectedStart, end);
  if (!isSlotAvailable(s.selectedStart, run.ctx(busy))) return slotTaken(run, s.selectedStart);
  return confirmBooking(run, s.selectedStart!, s.customerName ?? run.knownName ?? "Cliente");
}

/**
 * Cria o evento pelo mesmo motor do painel (specs/006 R2): dentro da trava, confere de novo a ocupação e a regra de um
 * horário por número (FR-015, FR-019).
 */
export async function book(run: Run): Promise<FlowResult> {
  const s = run.session!;
  const start = s.selectedStart!;
  // O resumo sempre tem o nome: ele vem de ask_name ou do nome conhecido
  const name = s.customerName ?? run.knownName ?? "Cliente";
  const service = s.service ?? ASSESSMENT;

  const result = await run.booking.bookSlot({
    phone: run.conversation.phone,
    name,
    service,
    start,
    origin: "assistant",
    conversationId: run.conversation.id,
  });
  switch (result.kind) {
    case "already_booked":
      return offerReschedule(run, result.appointment);
    case "slot_taken":
      return slotTaken(run, start);
    case "calendar_unavailable":
      throw new CalendarUnavailable("agenda desconectada durante a marcação");
    case "booked":
      await run.store.clearSession(run.conversation.id);
      return { reply: run.replies.booked(start, run.tz, s.customerName ?? run.knownName) };
  }
}
