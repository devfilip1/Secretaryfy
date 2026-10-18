import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { createRagClient } from "../modules/rag/client.js";
import { createSchedulingFlow } from "../modules/scheduling/flow.js";
import { createInterpreter } from "../modules/scheduling/interpret.js";
import { createOllamaClient } from "../modules/scheduling/ollama.js";
import { createSchedulingRouter } from "../modules/scheduling/router.js";
import { createSchedulingStore } from "../modules/scheduling/sessions.js";
import { parseEvolutionEvent, sendWhatsAppText } from "../modules/whatsapp/evolution.js";
import { createMessageHandler, createRagAnswerer } from "../modules/whatsapp/handle-message.js";
import { instance } from "../modules/whatsapp/instance.js";
import { connectionStore, googleCalendar, rulesStore } from "./calendar.js";
import { inbox } from "./inbox.js";

// Agendamento (specs/003): o Ollama interpreta, a máquina de estados decide; dúvidas seguem para o RAG da feature 001
const schedulingStore = createSchedulingStore(db);
const reply = createSchedulingRouter({
  interpreter: createInterpreter({
    ollama: createOllamaClient({ url: env.OLLAMA_URL, model: env.AGENT_MODEL, timeoutMs: env.AGENT_TIMEOUT_MS }),
  }),
  flow: createSchedulingFlow({
    calendar: googleCalendar,
    connection: connectionStore,
    rules: rulesStore,
    store: schedulingStore,
    inbox,
  }),
  store: schedulingStore,
  inbox,
  connection: connectionStore,
  rules: rulesStore,
  answerQuestion: createRagAnswerer(createRagClient({ baseUrl: env.RAG_SERVICE_URL, timeoutMs: env.RAG_TIMEOUT_MS }).ask),
});

const handleMessage = createMessageHandler({ reply, send: sendWhatsAppText, inbox });

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
    if (event?.kind === "message") {
      // Em segundo plano: registrar e responder não pode atrasar o webhook
      void (async () => {
        const { created, conversation } = await inbox.recordIncoming(event);
        if (!created) return;
        req.log.info({ phone: event.phone, fromMe: event.fromMe }, "mensagem registrada");
        if (!event.fromMe) await handleMessage({ conversationId: conversation.id, message: event }, req.log);
      })().catch((err) => req.log.error({ err, phone: event.phone }, "falha ao processar mensagem"));
    } else if (event) {
      instance.applyEvent(event);
    }

    // Responde rápido para a Evolution API não reenviar o evento
    return reply.code(200).send();
  });
}
