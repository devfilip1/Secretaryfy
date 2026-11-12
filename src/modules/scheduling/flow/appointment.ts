import type { AppointmentRow } from "../../../db/schema.js";
import { CalendarUnavailable } from "../../google/gateway.js";
import { initialReminderStatus } from "../../reminders/status.js";
import { isSlotAvailable } from "../availability.js";
import type { FlowResult } from "../flow.js";
import type { DayPeriod } from "../interpret.js";
import { withCalendarLock } from "../lock.js";
import { askedTime, offerDay, offerDays, slotTaken } from "./offers.js";
import type { Run } from "./run.js";

/** O próximo horário do telefone, venha ele desta conversa, de outra ou do painel (specs/006 R1). */
export async function currentAppointment(run: Run): Promise<AppointmentRow | null> {
  return run.upcomingAppointment();
}

async function refreshSessionAppointment(run: Run): Promise<AppointmentRow | null> {
  const id = run.session?.appointmentId;
  return run.sync(id ? await run.store.findAppointment(id) : null);
}

export async function keep(run: Run): Promise<FlowResult> {
  const appt = await refreshSessionAppointment(run);
  return run.finish(appt ? run.replies.keptAppointment(appt.startsAt, run.tz) : run.replies.stopped());
}

// --- Cancelar (FR-026, FR-027) ---

export async function startCancel(run: Run): Promise<FlowResult> {
  const appt = await currentAppointment(run);
  if (!appt) return run.finish(run.replies.noAppointment());
  if (run.tooLate(appt)) return run.finish(run.replies.tooLateToChange(run.rules.cancelNoticeMinutes));
  run.carry = { ...run.carry, flow: "cancel", appointmentId: appt.id };
  await run.save({ step: "confirm_cancel" });
  return { reply: run.replies.confirmCancel(appt.startsAt, run.tz) };
}

export async function cancel(run: Run): Promise<FlowResult> {
  // Sem a trava aqui: o cancelamento do motor de marcação a pega, e ela não aceita aninhamento
  const appt = await refreshSessionAppointment(run);
  if (!appt) return run.finish(run.replies.noAppointment());
  if (run.tooLate(appt)) return run.finish(run.replies.tooLateToChange(run.rules.cancelNoticeMinutes));
  const result = await run.booking.cancelAppointment({ id: appt.id, by: "customer", conversationId: run.conversation.id });
  switch (result.kind) {
    case "cancelled":
      return run.finish(run.replies.cancelled(appt.startsAt, run.tz));
    case "not_found":
      return run.finish(run.replies.noAppointment());
    case "calendar_unavailable":
      throw new CalendarUnavailable("agenda desconectada durante o cancelamento");
  }
}

// --- Remarcar ---

export async function offerReschedule(run: Run, appt: AppointmentRow): Promise<FlowResult> {
  run.carry = { ...run.carry, flow: "book", appointmentId: appt.id };
  await run.save({ step: "offer_reschedule" });
  return { reply: run.replies.alreadyBooked(appt.startsAt, run.tz) };
}

/** Com dia (e horário ou parte do dia) pedidos, oferece esses horários; sem dia, oferece os dias. */
export async function startReschedule(run: Run, date: string | null, time: string | null, period: DayPeriod | null): Promise<FlowResult> {
  const appt = run.session?.step === "offer_reschedule" ? await refreshSessionAppointment(run) : await currentAppointment(run);
  if (!appt) return run.finish(run.replies.noAppointment());
  if (run.tooLate(appt)) return run.finish(run.replies.tooLateToChange(run.rules.cancelNoticeMinutes));
  run.carry = { ...run.carry, flow: "reschedule", appointmentId: appt.id };
  // O horário que se remarca tem o próprio tempo: os horários oferecidos nesta mesma vez contam com ele
  run.minutes = Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000);
  if (date && time) return askedTime(run, date, time);
  if (date) return offerDay(run, date, period);
  return offerDays(run);
}

export function move(run: Run): Promise<FlowResult> {
  const start = run.session!.selectedStart!;
  const end = new Date(start.getTime() + run.minutes * 60_000);

  return withCalendarLock(async () => {
    const appt = await refreshSessionAppointment(run);
    if (!appt) return run.finish(run.replies.noAppointment());
    if (run.tooLate(appt)) return run.finish(run.replies.tooLateToChange(run.rules.cancelNoticeMinutes));

    // O próprio horário atual não conta como ocupado
    const busy = (await run.calendar.busy(start, end)).filter(
      (b) => b.start.getTime() !== appt.startsAt.getTime() || b.end.getTime() !== appt.endsAt.getTime(),
    );
    if (!isSlotAvailable(start, run.ctx(busy))) return slotTaken(run, start);

    await run.calendar.moveEvent(appt.googleEventId, start, end);
    if (!(await run.store.updateTimes(appt.id, start, end, initialReminderStatus(start, run.now, run.reminderLeadMinutes)))) {
      await run.calendar.moveEvent(appt.googleEventId, appt.startsAt, appt.endsAt).catch(() => {});
      return slotTaken(run, start);
    }
    await run.inbox.recordSystem(run.conversation.id, {
      kind: "rescheduled",
      from: appt.startsAt.toISOString(),
      to: start.toISOString(),
      timeZone: run.tz,
    });
    return run.finish(run.replies.rescheduled(start, run.tz));
  });
}
