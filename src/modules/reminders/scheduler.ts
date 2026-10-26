import type { AppointmentRow } from "../../db/schema.js";
import type { Gate } from "../antiban/gate.js";
import type { ConnectionStore } from "../google/connection.js";
import { FALLBACK_TIME_ZONE, type CalendarGateway } from "../google/gateway.js";
import type { InboxRepository } from "../inbox/repository.js";
import type { InboxService } from "../inbox/service.js";
import { syncAppointment } from "../scheduling/booking.js";
import { reminderReasonText, replies, systemNotes } from "../scheduling/replies.js";
import { ASSESSMENT } from "../scheduling/services.js";
import type { SchedulingStore } from "../scheduling/sessions.js";

const MINUTE = 60_000;

interface Deps {
  store: Pick<
    SchedulingStore,
    "dueReminders" | "markReminderSent" | "setReminderReason" | "markReminderNotSent" | "markCancelled" | "updateTimes" | "getSession"
  >;
  calendar: Pick<CalendarGateway, "getEvent">;
  connection: Pick<ConnectionStore, "getForUse">;
  gate: Pick<Gate, "assistantBlockReason" | "sendAssistant" | "pickVariant">;
  inboxRepo: Pick<InboxRepository, "findConversationByPhone" | "customerMessagesSinceLastReply">;
  inbox: Pick<InboxService, "recordSystem" | "knownName">;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  now?: () => Date;
  /** A partir de quanto antes do horário o lembrete pode sair (padrão 24 h) */
  leadMinutes: number;
  /** Depois disso (minutos antes do horário) o lembrete não sai mais (padrão 2 h) */
  cutoffMinutes: number;
  tickMs: number;
}

/**
 * Lembrete pelo WhatsApp antes de cada horário (specs/006 US4, research.md R3 e R4). Um passo por vez percorre os
 * lembretes pendentes que entraram na janela. Nada sai fora da janela de 24 h do cliente: aí o horário fica para o
 * operador lembrar ("Remind manually"). Todo envio passa pelo portão da proteção do número, como qualquer resposta.
 */
export function createReminderScheduler({
  store,
  calendar,
  connection,
  gate,
  inboxRepo,
  inbox,
  log,
  now: clock = () => new Date(),
  leadMinutes,
  cutoffMinutes,
  tickMs,
}: Deps) {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function notSent(appt: AppointmentRow, reason: string, conversationId: string | null, timeZone: string) {
    // Só registra quem de fato mudou o lembrete: dois passos não registram duas vezes
    if (!(await store.markReminderNotSent(appt.id, reason))) return;
    log.info({ appointmentId: appt.id, reason }, "lembrete não enviado");
    if (conversationId) await inbox.recordSystem(conversationId, systemNotes.reminderNotSent(appt.startsAt, reminderReasonText(reason), timeZone));
  }

  /** Guarda o motivo da espera, sem escrever de novo o mesmo motivo a cada passo. */
  async function waiting(appt: AppointmentRow, reason: string) {
    if (appt.reminderReason !== reason) await store.setReminderReason(appt.id, reason);
  }

  async function remind(appt: AppointmentRow, ctx: { now: Date; timeZone: string; connected: boolean }) {
    const { now, timeZone } = ctx;
    const conversation = await inboxRepo.findConversationByPhone(appt.phone);
    const conversationId = conversation?.id ?? null;

    // Perto demais do horário: o lembrete não sai mais (FR-023)
    if (appt.startsAt.getTime() - now.getTime() < cutoffMinutes * MINUTE) {
      return notSent(appt, appt.reminderReason ?? "too_late", conversationId, timeZone);
    }
    // Sem agenda conectada não dá para conferir o horário no Google: espera
    if (!ctx.connected) return;

    // O Google manda: apagado lá não recebe lembrete; movido tem o lembrete recalculado (FR-025)
    const current = await syncAppointment(
      { calendar, store, inbox, reminderLeadMinutes: leadMinutes },
      appt,
      { now, timeZone, conversationId },
    );
    if (!current || current.reminderStatus !== "pending") return;
    if (current.startsAt.getTime() - now.getTime() > leadMinutes * MINUTE) return;

    // Nunca escreve primeiro para quem não tem conversa (opção B da spec, FR-022)
    if (!conversation) return waiting(current, "no_conversation");
    // Não passa na frente da resposta que o cliente espera, nem atrapalha um agendamento em andamento
    if ((await inboxRepo.customerMessagesSinceLastReply(conversation.id)).length > 0) return;
    if (await store.getSession(conversation.id, now)) return;

    const name = await inbox.knownName(conversation);
    const options = replies.reminder(current.startsAt, current.service ?? ASSESSMENT, name, timeZone);
    const text = await gate.pickVariant(conversation.id, options);
    if (!text) return waiting(current, "duplicate");

    const blocked = await gate.assistantBlockReason({ conversationId: conversation.id, phone: conversation.phone, text });
    if (blocked === "opted_out") return notSent(current, blocked, conversation.id, timeZone);
    if (blocked) return waiting(current, blocked);

    const outcome = await gate.sendAssistant({ conversationId: conversation.id, phone: conversation.phone, text });
    if (outcome !== "sent") return waiting(current, outcome === "failed" ? "failed" : "blocked");
    if (await store.markReminderSent(current.id, clock())) {
      log.info({ appointmentId: current.id, conversationId: conversation.id }, "lembrete enviado");
      await inbox.recordSystem(conversation.id, systemNotes.reminderSent(current.startsAt, timeZone));
    }
  }

  const scheduler = {
    /** Um passo do agendador. Um passo em andamento faz o próximo ser ignorado. */
    async tick() {
      if (running) return;
      running = true;
      try {
        const now = clock();
        const due = await store.dueReminders(new Date(now.getTime() + leadMinutes * MINUTE));
        if (due.length === 0) return;
        const conn = await connection.getForUse();
        const ctx = { now, timeZone: conn?.timeZone ?? FALLBACK_TIME_ZONE, connected: conn?.status === "connected" };
        for (const appt of due) {
          try {
            await remind(appt, ctx);
          } catch (err) {
            // Um horário com problema (Google fora do ar, por exemplo) não impede os outros
            log.error({ appointmentId: appt.id, err }, "falha no lembrete");
          }
        }
      } finally {
        running = false;
      }
    },

    start() {
      if (timer) return;
      timer = setInterval(() => {
        scheduler.tick().catch((err) => log.error({ err }, "falha no agendador de lembretes"));
      }, tickMs);
      timer.unref?.();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
  return scheduler;
}

export type ReminderScheduler = ReturnType<typeof createReminderScheduler>;
