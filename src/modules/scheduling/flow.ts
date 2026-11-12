import type { ConversationRow, SchedulingSessionRow } from "../../db/schema.js";
import type { ClinicContext } from "../clinic/context.js";
import type { CustomerRepository } from "../customers/repository.js";
import type { ConnectionStore } from "../google/connection.js";
import { CalendarUnavailable, type CalendarGateway } from "../google/gateway.js";
import type { InboxService } from "../inbox/service.js";
import { createBooking, DEFAULT_REMINDER_LEAD_MINUTES } from "./booking.js";
import type { ServiceCatalog } from "./catalog.js";
import { dispatch } from "./flow/dispatch.js";
import { Run } from "./flow/run.js";
import type { Interpretation } from "./interpret.js";
import type { Replies } from "./replies.js";
import type { RulesStore } from "./rules.js";
import type { SchedulingStore } from "./sessions.js";

export interface FlowResult {
  reply: string;
  /** O assistente desistiu e pausou a conversa: a resposta deve ser enviada mesmo assim */
  handoff?: boolean;
}

interface Deps {
  calendar: CalendarGateway;
  connection: Pick<ConnectionStore, "getForUse">;
  rules: Pick<RulesStore, "get">;
  store: SchedulingStore;
  inbox: Pick<InboxService, "recordSystem" | "flagNeedsAttention" | "setCustomerName">;
  /** Cadastro de clientes: quem confirma um horário entra nele (specs/005, US3) */
  customers: Pick<CustomerRepository, "upsert">;
  log?: { error: (obj: object, msg: string) => void };
  now?: () => Date;
  /** Antecedência do lembrete, para o status inicial e o de um horário remarcado (specs/006) */
  reminderLeadMinutes?: number;
  /** Textos na língua da clínica (replies.ts, createReplies) */
  replies: Replies;
  /** Os tratamentos que o cliente pode marcar (catalog.ts): a lista da escolha */
  catalog: ServiceCatalog;
  /** Língua da clínica, lida a cada marcação: o título na agenda e a nota seguem ela */
  clinic: Pick<ClinicContext, "language">;
}

/** Máquina de estados do agendamento (data-model.md). O modelo só interpreta; quem decide e escreve é o código. */
export function createSchedulingFlow({
  calendar,
  connection,
  rules: rulesStore,
  store,
  inbox,
  customers,
  log = console,
  now: clock = () => new Date(),
  reminderLeadMinutes = DEFAULT_REMINDER_LEAD_MINUTES,
  replies,
  catalog,
  clinic,
}: Deps) {
  // A marcação em si é a mesma do painel (specs/006 research.md R2)
  const booking = createBooking({ calendar, connection, rules: rulesStore, store, inbox, customers, catalog, clinic, log, now: clock, reminderLeadMinutes });
  return {
    async handle({
      conversation,
      interpretation,
      session,
      knownName = null,
      mentionedService = null,
    }: {
      conversation: ConversationRow;
      interpretation: Interpretation;
      session: SchedulingSessionRow | null;
      /** O nome que o cliente disse ou o do cadastro; nunca o do perfil do WhatsApp (specs/005 FR-007) */
      knownName?: string | null;
      /** O tratamento citado por último na conversa (specs/005 FR-010) */
      mentionedService?: string | null;
    }): Promise<FlowResult> {
      const conn = await connection.getForUse();
      if (!conn || conn.status !== "connected") {
        await store.clearSession(conversation.id);
        return { reply: replies.calendarUnavailable() };
      }
      const run = new Run({
        calendar,
        store,
        inbox,
        booking,
        reminderLeadMinutes,
        replies,
        catalog,
        conversation,
        session,
        knownName,
        mentionedService,
        now: clock(),
        tz: conn.timeZone,
        calendarId: conn.calendarId,
        rules: await rulesStore.get(),
      });
      try {
        return await dispatch(run, interpretation);
      } catch (err) {
        // Google fora do ar ou sem acesso: nada fica marcado pela metade (FR-022)
        if (err instanceof CalendarUnavailable) return { reply: replies.calendarUnavailable() };
        throw err;
      }
    },
  };
}

export type SchedulingFlow = ReturnType<typeof createSchedulingFlow>;
