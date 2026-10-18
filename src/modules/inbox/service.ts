import type { MessageRow } from "../../db/schema.js";
import type { IncomingMessage } from "../whatsapp/evolution.js";
import type { Publish } from "./events.js";
import { presentConversation, presentMessage, previewOf } from "./presenters.js";
import type { InboxRepository } from "./repository.js";

/** Janela em que o eco de um envio do sistema é casado pelo texto (research.md R6). */
export const ECHO_WINDOW_MS = 60_000;

export type SendResult = { waId: string } | { error: string };

/** Regras das conversas: registro, eco, envios do sistema, pausa e leitura. */
export function createInboxService({
  repo,
  publish,
  now = Date.now,
}: {
  repo: InboxRepository;
  publish: Publish;
  now?: () => number;
}) {
  function publishMessage(type: "message.created" | "message.updated", message: MessageRow) {
    publish({ type, conversationId: message.conversationId, message: presentMessage(message) });
  }

  async function publishConversation(id: string) {
    const conversation = await repo.findConversation(id);
    if (conversation) publish({ type: "conversation.updated", conversation: presentConversation(conversation) });
    return conversation;
  }

  const service = {
    /** Registra uma mensagem vinda da Evolution API (cliente, celular ou eco de um envio do sistema). */
    async recordIncoming(msg: IncomingMessage) {
      const conversation = await repo.upsertConversation({
        phone: msg.phone,
        name: msg.fromMe ? null : (msg.pushName ?? null),
        at: msg.sentAt,
        preview: previewOf(msg),
      });

      if (msg.fromMe) {
        if (await repo.findMessageByWaId(msg.id)) return { created: false as const, conversation };
        const pending = msg.text
          ? await repo.findPendingEcho(conversation.id, msg.text, new Date(now() - ECHO_WINDOW_MS))
          : null;
        if (pending) {
          // O eco chegou antes da resposta do sendText: é a mesma mensagem
          const updated = await repo.updateMessage(pending.id, { waMessageId: msg.id, status: "sent" });
          if (updated) publishMessage("message.updated", updated);
          return { created: false as const, conversation };
        }
      }

      const origin = msg.fromMe ? "phone" : "customer";
      const message = await repo.insertMessage({
        conversationId: conversation.id,
        waMessageId: msg.id,
        origin,
        type: msg.type,
        text: msg.text,
        status: msg.fromMe ? "sent" : "received",
        sentAt: msg.sentAt,
      });
      if (!message) return { created: false as const, conversation };

      const touched = await repo.touchConversation(conversation.id, {
        lastMessageAt: msg.sentAt,
        preview: previewOf(msg),
        incrementUnread: origin === "customer",
      });
      publishMessage("message.created", message);
      publish({ type: "conversation.updated", conversation: presentConversation(touched) });
      return { created: true as const, conversation: touched, message };
    },

    /** Grava um envio do sistema antes de chamar a Evolution API. Com `pause`, pausa o assistente junto. */
    async startOutgoing(v: { conversationId: string; origin: "assistant" | "operator"; text: string; pause?: boolean }) {
      const at = new Date(now());
      const message = await repo.transaction(async (tx) => {
        const row = await tx.insertMessage({
          conversationId: v.conversationId,
          origin: v.origin,
          type: "text",
          text: v.text,
          status: "sending",
          sentAt: at,
        });
        if (v.pause) await tx.setPaused(v.conversationId, true);
        await tx.touchConversation(v.conversationId, {
          lastMessageAt: at,
          preview: previewOf({ type: "text", text: v.text }),
          incrementUnread: false,
        });
        return row!;
      });
      publishMessage("message.created", message);
      await publishConversation(v.conversationId);
      return message;
    },

    /** Registra o resultado do envio: sent com o id do WhatsApp, ou failed com o motivo. */
    async finishOutgoing(messageId: string, result: SendResult) {
      let message: MessageRow | null;
      if ("waId" in result) {
        const echo = await repo.findMessageByWaId(result.waId);
        // Corrida: o eco já entrou como mensagem do celular; fica só a linha do sistema
        if (echo && echo.id !== messageId) await repo.deleteMessage(echo.id);
        message = await repo.updateMessage(messageId, { waMessageId: result.waId, status: "sent", error: null });
      } else {
        message = await repo.updateMessage(messageId, { status: "failed", error: result.error });
      }
      if (message) publishMessage("message.updated", message);
      return message;
    },

    async isPaused(conversationId: string): Promise<boolean> {
      return (await repo.findConversation(conversationId))?.assistantPaused ?? false;
    },

    async markRead(conversationId: string) {
      const row = await repo.markRead(conversationId);
      if (row) publish({ type: "conversation.updated", conversation: presentConversation(row) });
      return row;
    },

    async setAssistantPaused(conversationId: string, paused: boolean) {
      const row = await repo.setPaused(conversationId, paused);
      if (row) publish({ type: "conversation.updated", conversation: presentConversation(row) });
      return row;
    },

    async getConversation(conversationId: string) {
      return repo.findConversation(conversationId);
    },

    /**
     * Registro do Secretaryfy no histórico (ex.: agendamento feito), não enviado ao WhatsApp. Não mexe na prévia
     * nem nas não lidas (specs/003, research.md R10).
     */
    async recordSystem(conversationId: string, text: string) {
      const message = await repo.insertMessage({
        conversationId,
        origin: "system",
        type: "text",
        text,
        status: "received",
        sentAt: new Date(now()),
      });
      if (message) publishMessage("message.created", message);
      return message;
    },

    /** O assistente desistiu de entender o cliente: pausa e destaca a conversa (FR-024a/b). */
    async flagNeedsAttention(conversationId: string) {
      const row = await repo.flagNeedsAttention(conversationId);
      if (row) publish({ type: "conversation.updated", conversation: presentConversation(row) });
      return row;
    },

    /** Contexto do modelo: as últimas mensagens de texto, em ordem cronológica (research.md R5). */
    async recentHistory(conversationId: string, limit = 20): Promise<{ role: "user" | "assistant"; content: string }[]> {
      const rows = await repo.recentTexts(conversationId, limit);
      return rows.reverse().map((r) => ({ role: r.origin === "customer" ? "user" : "assistant", content: r.text ?? "" }));
    },

    /** Envio pelo painel: pausa o assistente na conversa (FR-022a) e registra o resultado. */
    async sendFromOperator(conversationId: string, text: string, deps: OperatorSendDeps) {
      const conversation = await repo.findConversation(conversationId);
      if (!conversation) throw new InboxError("not_found");
      if (!deps.isConnected()) throw new InboxError("whatsapp_disconnected");
      const pending = await service.startOutgoing({ conversationId, origin: "operator", text, pause: true });
      return (await deliver(pending, conversation.phone, deps))!;
    },

    /** Reenvia uma mensagem do operador que falhou (FR-013). */
    async retry(messageId: string, deps: OperatorSendDeps) {
      const message = await repo.findMessage(messageId);
      if (!message) throw new InboxError("not_found");
      if (message.origin !== "operator" || message.status !== "failed") throw new InboxError("not_retryable");
      if (!deps.isConnected()) throw new InboxError("whatsapp_disconnected");
      const conversation = await repo.findConversation(message.conversationId);
      const sending = await repo.updateMessage(messageId, { status: "sending", error: null });
      publishMessage("message.updated", sending!);
      return (await deliver(sending!, conversation!.phone, deps))!;
    },
  };

  async function deliver(message: MessageRow, phone: string, { send }: OperatorSendDeps) {
    try {
      const { waId } = await send(phone, message.text ?? "");
      return service.finishOutgoing(message.id, { waId });
    } catch (err) {
      return service.finishOutgoing(message.id, { error: (err as Error).message });
    }
  }

  return service;
}

export interface OperatorSendDeps {
  send: (phone: string, text: string) => Promise<{ waId: string }>;
  isConnected: () => boolean;
}

/** Erro de regra do inbox, traduzido em status HTTP pelas rotas. */
export class InboxError extends Error {
  constructor(readonly code: "not_found" | "whatsapp_disconnected" | "not_retryable") {
    super(code);
    this.name = "InboxError";
  }
}

export type InboxService = ReturnType<typeof createInboxService>;
