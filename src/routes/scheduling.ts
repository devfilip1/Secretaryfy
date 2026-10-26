import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { bus } from "../modules/inbox/events.js";
import { createBooking } from "../modules/scheduling/booking.js";
import { createSchedulingFlow } from "../modules/scheduling/flow.js";
import { createSchedulingStore, withAppointmentEvents } from "../modules/scheduling/sessions.js";
import { connectionStore, googleCalendar, rulesStore } from "./calendar.js";
import { customerRepo, inbox } from "./inbox.js";

/**
 * Instâncias do processo, compartilhadas pelo webhook, pela API do painel e pelo agendador de lembretes. Toda escrita em
 * `appointments` avisa a aba de agendamentos (specs/006 R9).
 */
export const schedulingStore = withAppointmentEvents(createSchedulingStore(db), () => bus.publish({ type: "appointments.updated" }));

const deps = {
  calendar: googleCalendar,
  connection: connectionStore,
  rules: rulesStore,
  store: schedulingStore,
  inbox,
  customers: customerRepo,
  reminderLeadMinutes: env.REMINDER_LEAD_MINUTES,
};

// Agendamento pelo WhatsApp (specs/003): o Ollama interpreta, a máquina de estados decide
export const schedulingFlow = createSchedulingFlow(deps);

// Marcação pelo painel (specs/006 US3): o mesmo motor do fluxo
export const booking = createBooking(deps);
