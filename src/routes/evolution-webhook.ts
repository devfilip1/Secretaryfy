import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { createRagClient } from "../modules/rag/client.js";
import { createInterpreter } from "../modules/scheduling/interpret.js";
import { createOllamaClient } from "../modules/scheduling/ollama.js";
import { createSchedulingRouter } from "../modules/scheduling/router.js";
import { createDebouncer } from "../modules/antiban/debounce.js";
import { matchCommand } from "../modules/antiban/opt-out.js";
import { parseEvolutionEvent, type IncomingMessage } from "../modules/whatsapp/evolution.js";
import { createMessageHandler, createRagAnswerer } from "../modules/whatsapp/handle-message.js";
import { instance } from "../modules/whatsapp/instance.js";
import { connectionStore, rulesStore } from "./calendar.js";
import { antibanConfig, antibanRepo, breaker, gate, inbox, inboxRepo } from "./inbox.js";
import { schedulingFlow, schedulingStore } from "./scheduling.js";

// Agendamento (specs/003): o Ollama interpreta, a máquina de estados decide; dúvidas seguem para o RAG da feature 001
const reply = createSchedulingRouter({
  interpreter: createInterpreter({
    ollama: createOllamaClient({ url: env.OLLAMA_URL, model: env.AGENT_MODEL, timeoutMs: env.AGENT_TIMEOUT_MS }),
  }),
  flow: schedulingFlow,
  store: schedulingStore,
  inbox,
  connection: connectionStore,
  rules: rulesStore,
  answerQuestion: createRagAnswerer(createRagClient({ baseUrl: env.RAG_SERVICE_URL, timeoutMs: env.RAG_TIMEOUT_MS }).ask),
});

const handleMessage = createMessageHandler({
  reply,
  gate,
  inbox,
  hasSchedulingSession: async (conversationId) => Boolean(await schedulingStore.getSession(conversationId, new Date())),
});

type Log = Parameters<typeof handleMessage>[1];

/**
 * Responde depois de alguns segundos de silêncio do cliente, a todas as mensagens dele desde a última resposta de uma
 * vez (specs/004 FR-007, research.md R4).
 */
/** Última mensagem do cliente respondida por conversa */
const answering = new Map<string, string>();

const debouncer = createDebouncer<{ log: Log }>({
  delayMs: antibanConfig.debounceMs,
  onFire: (conversationId, { log }) => {
    void (async () => {
      const unread = (await inboxRepo.customerMessagesSinceLastReply(conversationId)).filter((m) => m.type === "text" && m.text);
      const last = unread.at(-1);
      const conversation = await inbox.getConversation(conversationId);
      if (!last || !conversation) return;
      // A mesma última mensagem já está sendo (ou foi) respondida: um segundo disparo não responde de novo
      if (answering.get(conversationId) === last.id) return;
      answering.set(conversationId, last.id);
      const message: IncomingMessage = {
        kind: "message",
        id: last.waMessageId ?? last.id,
        phone: conversation.phone,
        fromMe: false,
        type: "text",
        text: unread.map((m) => m.text).join("\n"),
        sentAt: last.sentAt,
      };
      await handleMessage({ conversationId, message }, log);
    })().catch((err) => log.error({ err, conversationId }, "falha ao responder"));
  },
});

/** O operador escreveu: a resposta que o assistente ainda ia dar não acontece. */
export function cancelPendingReply(conversationId: string) {
  debouncer.cancel(conversationId);
}

/** Número conectado: o primeiro uso começa o aquecimento (specs/004 FR-023). */
export async function rememberNumber(number: string) {
  const { isNew } = await antibanRepo.rememberConnectedNumber(number, new Date());
  if (isNew) await gate.onNumberConnected();
}

function validToken(token: string | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(env.EVOLUTION_WEBHOOK_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function evolutionWebhookRoutes(app: FastifyInstance) {
  app.post<{ Querystring: { token?: string } }>("/webhooks/evolution", async (req, reply) => {
    if (!validToken(req.query.token)) return reply.code(401).send();

    const event = parseEvolutionEvent(req.body);
    if (!event) {
      // Mensagem descartada (grupo, reação, endereço sem número...): fica no log para não sumir em silêncio
      const body = req.body as { event?: string; data?: { key?: { remoteJid?: string } } } | null;
      if (body?.event?.toLowerCase().replace(/_/g, ".") === "messages.upsert") {
        req.log.info({ remoteJid: body.data?.key?.remoteJid }, "mensagem recebida e ignorada");
      }
    }
    if (event?.kind === "message") {
      // Em segundo plano: registrar e responder não pode atrasar o webhook
      void (async () => {
        const { created, conversation } = await inbox.recordIncoming(event);
        if (!created) return;
        req.log.info({ phone: event.phone, fromMe: event.fromMe }, "mensagem registrada");
        if (event.fromMe) return;
        // Pedido de saída ou de volta é atendido na hora, sozinho, sem esperar nem se juntar a outras mensagens
        if (event.text && matchCommand(event.text, { inSchedulingFlow: false })) {
          debouncer.cancel(conversation.id);
          await handleMessage({ conversationId: conversation.id, message: event }, req.log);
          return;
        }
        // Mídia, reação ou edição ("Mensagem não suportada") não pede resposta e não pode repetir a do texto anterior
        if (event.type !== "text" || !event.text) return;
        debouncer.push(conversation.id, { log: req.log });
      })().catch((err) => req.log.error({ err, phone: event.phone }, "falha ao processar mensagem"));
    } else if (event) {
      const wasOpen = instance.getState().state === "open";
      instance.applyEvent(event);
      if (event.kind === "connection" && event.loggedOut) {
        void inbox
          .clearAll()
          .then((deleted) => req.log.info({ deleted }, "número desconectado: conversas apagadas"))
          .catch((err) => req.log.error({ err }, "falha ao apagar as conversas"));
      } else if (event.kind === "connection" && event.state === "close" && wasOpen) {
        // Quedas seguidas de uma conexão aberta contam para o freio (specs/004 FR-026); um QR não lido não conta
        void breaker.recordDrop().catch((err) => req.log.error({ err }, "falha ao registrar a queda"));
      } else if (event.kind === "connection" && event.state === "open" && event.number) {
        void rememberNumber(event.number).catch((err) => req.log.error({ err }, "falha ao registrar o número"));
      }
    }

    // Responde rápido para a Evolution API não reenviar o evento
    return reply.code(200).send();
  });
}
