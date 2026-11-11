import { DateTime } from "luxon";
import type { SchedulingSessionRow } from "../../../db/schema.js";
import { asksPeriodOfScreen, isTooFar } from "../intents.js";
import type { FlowResult } from "../flow.js";
import type { Interpretation } from "../interpret.js";
import { systemNotes } from "../replies.js";
import { currentAppointment, cancel, keep, move, startCancel, startReschedule } from "./appointment.js";
import { book, nameGiven, serviceChosen, startBook } from "./booking.js";
import {
  askedTime,
  moreSlots,
  offerDay,
  offerDayOrTime,
  offerDays,
  periodOfScreen,
  sameDayAsOptions,
  selectSlot,
  tooFar,
  timeNotOffered,
} from "./offers.js";
import type { Run } from "./run.js";

/** Na segunda resposta não entendida seguida, o assistente passa a conversa para o operador (FR-024a). */
const MAX_MISUNDERSTOOD = 2;

/** Roteia a interpretação para a jornada certa, conforme o intent e a etapa da sessão. */
export async function dispatch(run: Run, i: Interpretation): Promise<FlowResult> {
  const s = run.session;
  run.minutes = await run.lengthFor();

  if (i.intent === "stop") return run.finish(run.replies.stopped());
  if (i.tooFar && isTooFar(i.intent)) return tooFar(run);
  // "de tarde" com os horários do dia na tela: a parte do dia desse mesmo dia
  if (s?.step === "choose_slot" && i.period && i.option === null && !i.date && !i.time && asksPeriodOfScreen(i.intent)) {
    return periodOfScreen(run, i.period);
  }

  const period = i.period ?? null;
  switch (i.intent) {
    case "book":
      return startBook(run, i.date, i.time ?? null, period);
    case "availability":
      return i.date ? offerDayOrTime(run, i.date, i.time ?? null, period) : offerDays(run);
    case "cancel":
      return startCancel(run);
    case "reschedule":
      return startReschedule(run, i.date, i.time ?? null, period);
    case "my_appointment": {
      const appt = await currentAppointment(run);
      return { reply: appt ? run.replies.myAppointment(appt.startsAt, run.tz) : run.replies.noAppointment() };
    }
  }

  switch (s?.step) {
    case "choose_day":
      if (i.intent === "choose" && i.option !== null) return offerDay(run, run.dayOption(i.option), period);
      if (i.intent === "choose" && i.date) return offerDayOrTime(run, i.date, i.time ?? null, period);
      if (i.intent === "more") return offerDays(run, { after: run.lastOfferedDay() });
      if (i.intent === "other_day") return offerDays(run);
      break;
    case "choose_slot":
      if (i.intent === "choose" && i.option !== null) {
        const slot = run.slotOption(i.option);
        // O modelo às vezes escolhe a opção mais próxima do horário citado: o horário citado manda
        if (i.time && DateTime.fromJSDate(slot, { zone: run.tz }).toFormat("HH:mm") !== i.time) return askedTime(run, run.isoDate(slot), i.time);
        return selectSlot(run, slot);
      }
      // Um horário citado se confere na grade inteira, no dia da tela ou no dia que o cliente nomeou
      if (i.intent === "choose" && i.time) return askedTime(run, i.date ?? run.isoDate(run.optionSlots(s.options)[0]), i.time);
      if (i.intent === "choose" && i.date) return sameDayAsOptions(run, i.date) && !period ? timeNotOffered(run) : offerDay(run, i.date, period);
      if (i.intent === "more") return moreSlots(run);
      if (i.intent === "other_day") return offerDays(run);
      break;
    case "ask_name":
      if (i.intent === "give_name" && i.name) return nameGiven(run, s.selectedStart!, i.name);
      break;
    case "choose_service":
      if (i.intent === "choose_service" && i.service) return serviceChosen(run, i.service);
      break;
    case "confirm_booking":
      if (i.intent === "yes") return book(run);
      // Outro tratamento no resumo troca o serviço (FR-012)
      if (i.intent === "choose_service" && i.service) return serviceChosen(run, i.service);
      // "my name is …" no resumo corrige o nome (FR-007)
      if (i.intent === "give_name" && i.name) return nameGiven(run, s.selectedStart!, i.name);
      if (i.intent === "no") return offerDay(run, run.isoDate(s.selectedStart!));
      break;
    case "offer_reschedule":
      if (i.intent === "yes") return startReschedule(run, null, null, null);
      if (i.intent === "no") return keep(run);
      break;
    case "confirm_cancel":
      if (i.intent === "yes") return cancel(run);
      if (i.intent === "no") return keep(run);
      break;
    case "confirm_reschedule":
      if (i.intent === "yes") return move(run);
      if (i.intent === "no") return offerDays(run);
      break;
  }
  return misunderstood(run);
}

async function misunderstood(run: Run): Promise<FlowResult> {
  const s = run.session;
  // Sem etapa em andamento não há pergunta a repetir nem contador
  if (!s) return { reply: run.replies.unclear(run.replies.howCanIHelp()) };
  const count = s.misunderstoodCount + 1;
  if (count >= MAX_MISUNDERSTOOD) {
    await run.store.clearSession(run.conversation.id);
    await run.inbox.flagNeedsAttention(run.conversation.id);
    await run.inbox.recordSystem(run.conversation.id, systemNotes.handoff());
    return { reply: run.replies.handoff(), handoff: true };
  }
  await run.store.saveSession(
    {
      conversationId: s.conversationId,
      flow: s.flow,
      step: s.step,
      options: s.options,
      selectedStart: s.selectedStart,
      customerName: s.customerName,
      service: s.service,
      appointmentId: s.appointmentId,
      misunderstoodCount: count,
    },
    run.now,
  );
  return { reply: run.replies.unclear(repeatPrompt(run, s)) };
}

/** A pergunta da etapa, repetida depois de um "não entendi". */
function repeatPrompt(run: Run, s: SchedulingSessionRow): string {
  switch (s.step) {
    case "choose_day":
      return run.replies.offerDays(run.optionDays(s.options), run.tz, run.replies.daysIntro());
    case "choose_slot": {
      const slots = run.optionSlots(s.options);
      return run.replies.offerSlots(run.isoDate(slots[0]), slots, run.tz, false);
    }
    case "ask_name":
      return run.replies.askName();
    case "choose_service":
      return run.replies.chooseService();
    default:
      return run.replies.yesOrNo();
  }
}
