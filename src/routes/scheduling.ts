import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { bus } from "../modules/inbox/events.js";
import { createBooking } from "../modules/scheduling/booking.js";
import { createSchedulingFlow } from "../modules/scheduling/flow.js";
import { createHumanizer } from "../modules/scheduling/humanize.js";
import { createOllamaClient } from "../modules/scheduling/ollama.js";
import { createSchedulingStore, withAppointmentEvents } from "../modules/scheduling/sessions.js";
import { createReplies } from "../modules/scheduling/replies.js";
import { connectionStore, googleCalendar, rulesStore } from "./calendar.js";
import { customerRepo, inbox } from "./inbox.js";

/**
 * Instâncias do processo, compartilhadas pelo webhook, pela API do painel e pelo agendador de lembretes. Toda escrita em
 * `appointments` avisa a aba de agendamentos (specs/006 R9).
 */
export const schedulingStore = withAppointmentEvents(createSchedulingStore(db), () => bus.publish({ type: "appointments.updated" }));

/** Textos aos clientes na língua e com o nome da clínica da configuração (CLINIC_LANGUAGE, CLINIC_NAME). */
export const schedulingReplies = createReplies({ language: env.CLINIC_LANGUAGE, clinicName: env.CLINIC_NAME });

/** Reescrita opcional das respostas do fluxo (HUMANIZE_REPLIES=1); sem ela, vale o texto fixo. */
export const humanize = env.HUMANIZE_REPLIES
  ? createHumanizer({
      ollama: createOllamaClient({ url: env.OLLAMA_URL, model: env.AGENT_MODEL, timeoutMs: env.AGENT_TIMEOUT_MS }),
      language: env.CLINIC_LANGUAGE,
      clinicName: env.CLINIC_NAME,
    }).humanize
  : undefined;

const deps = {
  calendar: googleCalendar,
  connection: connectionStore,
  rules: rulesStore,
  store: schedulingStore,
  inbox,
  customers: customerRepo,
  reminderLeadMinutes: env.REMINDER_LEAD_MINUTES,
  replies: schedulingReplies,
};

// Agendamento pelo WhatsApp (specs/003): o Ollama interpreta, a máquina de estados decide
export const schedulingFlow = createSchedulingFlow(deps);

// Marcação pelo painel (specs/006 US3): o mesmo motor do fluxo
export const booking = createBooking(deps);
