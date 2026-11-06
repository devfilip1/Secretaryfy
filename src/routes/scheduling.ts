import { env } from "../config/env.js";
import { createClinicContext } from "../modules/clinic/context.js";
import { createClinicSettingsRepository } from "../modules/clinic/settings-repository.js";
import { db } from "../db/client.js";
import { bus } from "../modules/inbox/events.js";
import { createBooking } from "../modules/scheduling/booking.js";
import { createSchedulingFlow } from "../modules/scheduling/flow.js";
import { createHumanizer } from "../modules/scheduling/humanize.js";
import { createOllamaClient } from "../modules/scheduling/ollama.js";
import { createSchedulingStore, withAppointmentEvents } from "../modules/scheduling/sessions.js";
import { createKnowledgeCatalog } from "../modules/scheduling/catalog.js";
import { createKnowledgeRepository } from "../modules/knowledge/repository.js";
import { createReplies } from "../modules/scheduling/replies.js";
import { connectionStore, googleCalendar, rulesStore } from "./calendar.js";
import { customerRepo, inbox } from "./inbox.js";

/**
 * Instâncias do processo, compartilhadas pelo webhook, pela API do painel e pelo agendador de lembretes. Toda escrita em
 * `appointments` avisa a aba de agendamentos (specs/006 R9).
 */
export const schedulingStore = withAppointmentEvents(createSchedulingStore(db), () => bus.publish({ type: "appointments.updated" }));

/** Identidade da clínica (ADR 0012, passo 2): semeada do env no boot, e a linha do banco vence (index.ts). */
export const clinic = createClinicContext({ name: env.CLINIC_NAME, assistantName: env.ASSISTANT_NAME, kind: env.CLINIC_KIND, language: env.CLINIC_LANGUAGE });

/** A identidade que o painel edita (a tabela clinic_settings). */
export const clinicSettings = createClinicSettingsRepository(db);

/** Conhecimento da clínica (a tabela que o painel edita): de onde vêm os tratamentos que se podem marcar. */
export const knowledge = createKnowledgeRepository(db);

/** Os tratamentos que o cliente pode marcar, lidos da tabela (ADR 0014): index.ts relê no boot e a cada mudança no painel. */
export const catalog = createKnowledgeCatalog({ repo: knowledge });

/** Textos aos clientes na língua; o nome e o da atendente são lidos da clínica a cada texto. */
export const schedulingReplies = createReplies({ language: clinic.language, clinic, catalog });

/** Reescrita opcional das respostas do fluxo (HUMANIZE_REPLIES=1); sem ela, vale o texto fixo. */
export const humanize = env.HUMANIZE_REPLIES
  ? createHumanizer({
      ollama: createOllamaClient({ url: env.OLLAMA_URL, model: env.AGENT_MODEL, timeoutMs: env.AGENT_TIMEOUT_MS }),
      language: clinic.language,
      clinic,
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
  catalog,
};

// Agendamento pelo WhatsApp (specs/003): o Ollama interpreta, a máquina de estados decide
export const schedulingFlow = createSchedulingFlow(deps);

// Marcação pelo painel (specs/006 US3): o mesmo motor do fluxo
export const booking = createBooking(deps);
