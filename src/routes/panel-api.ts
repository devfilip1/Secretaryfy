import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { presentConversation, presentMessage } from "../modules/inbox/presenters.js";
import type { InboxRepository } from "../modules/inbox/repository.js";
import { InboxError, type InboxService, type OperatorSendDeps } from "../modules/inbox/service.js";
import { protectionNotes } from "../modules/antiban/texts.js";
import { AlreadyConnected, EvolutionError, TooManyAttempts, type InstanceManager } from "../modules/whatsapp/instance.js";

interface Deps {
  inbox: InboxService;
  repo: InboxRepository;
  instance: Pick<InstanceManager, "getState" | "isKnown" | "refresh" | "prepareQr" | "logout">;
  send: (phone: string, text: string) => Promise<{ waId: string }>;
  /** Riscos que o operador confirma antes de enviar (specs/004); sem a função, nenhum */
  risks?: OperatorSendDeps["risks"];
  /** O operador escreveu numa conversa: a resposta pendente do assistente não acontece */
  onOperatorMessage?: (conversationId: string) => void;
}

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ q: z.string().optional() });
const messagesQuery = z.object({
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const sendBody = z.object({ text: z.string().trim().min(1).max(4096), confirmRisk: z.boolean().optional() });
const retryBody = z.object({ confirmRisk: z.boolean().optional() });
// O operador só reativa; marcar a saída em nome do cliente não é permitido (specs/004 contracts/panel-api.md)
const patchBody = z.union([z.object({ assistantPaused: z.boolean() }).strict(), z.object({ optedOut: z.literal(false) }).strict()]);

const STATUS_BY_CODE = {
  not_found: 404,
  whatsapp_disconnected: 409,
  not_retryable: 409,
  risk_confirmation_required: 409,
  retry_too_soon: 429,
} as const;

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "not_found" });
}

/** API do painel (contracts/panel-api.md). A autenticação fica no hook de panel-session.ts. */
export function panelApiRoutes({ inbox, repo, instance, send, risks, onOperatorMessage }: Deps) {
  const operatorDeps = (confirmRisk?: boolean): OperatorSendDeps => ({
    send,
    isConnected: () => instance.getState().state === "open",
    risks,
    confirmRisk,
    onOperatorMessage,
  });

  return async function (app: FastifyInstance) {
    // --- Conexão do WhatsApp ---

    app.get("/api/connection", async (req) => {
      if (!instance.isKnown()) await instance.refresh().catch((err) => req.log.warn({ err }, "estado da conexão indisponível"));
      return instance.getState();
    });

    app.post("/api/connection/qr", async (req, reply) => {
      try {
        return await instance.prepareQr();
      } catch (err) {
        if (err instanceof AlreadyConnected) return reply.code(409).send({ error: "already_connected" });
        if (err instanceof TooManyAttempts) {
          return reply.code(429).send({ error: "too_many_attempts", retryAt: err.retryAt.toISOString() });
        }
        if (err instanceof EvolutionError) {
          req.log.error({ err }, "falha ao pedir QR code");
          return reply.code(502).send({ error: "evolution_unavailable", detail: err.message });
        }
        throw err;
      }
    });

    app.delete("/api/connection", async (req, reply) => {
      try {
        await instance.logout();
        // Desconectar não deixa nenhuma conversa; se a Evolution recusar, o número continua e as conversas também
        await inbox.clearAll();
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof EvolutionError) {
          req.log.error({ err }, "falha ao desconectar");
          return reply.code(502).send({ error: "evolution_unavailable", detail: err.message });
        }
        throw err;
      }
    });

    // --- Conversas ---

    app.get("/api/conversations", async (req) => {
      const { q } = listQuery.parse(req.query);
      const rows = await repo.listConversations({ q });
      const optedOut = await repo.optedOutAmong(rows.map((r) => r.phone));
      return { conversations: rows.map((r) => presentConversation(r, optedOut.has(r.phone))) };
    });

    app.get("/api/conversations/:id/messages", async (req, reply) => {
      const params = idParams.safeParse(req.params);
      const query = messagesQuery.safeParse(req.query);
      if (!params.success) return notFound(reply);
      if (!query.success) return reply.code(422).send({ error: "invalid_query" });
      const conversation = await repo.findConversation(params.data.id);
      if (!conversation) return notFound(reply);
      const page = await repo.listMessages(conversation.id, query.data);
      return {
        conversation: await inbox.present(conversation),
        messages: page.messages.map(presentMessage),
        hasMore: page.hasMore,
      };
    });

    app.post("/api/conversations/:id/read", async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success || !(await inbox.markRead(params.data.id))) return notFound(reply);
      return reply.code(204).send();
    });

    app.patch("/api/conversations/:id", async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) return notFound(reply);
      const body = patchBody.safeParse(req.body);
      if (!body.success) return reply.code(422).send({ error: "invalid_body" });
      const row =
        "optedOut" in body.data
          ? await inbox.setOptedOut(params.data.id, false, protectionNotes.reactivated)
          : await inbox.setAssistantPaused(params.data.id, body.data.assistantPaused);
      if (!row) return notFound(reply);
      return inbox.present(row);
    });

    // --- Mensagens do operador ---

    app.post("/api/conversations/:id/messages", async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) return notFound(reply);
      const body = sendBody.safeParse(req.body);
      if (!body.success) return reply.code(422).send({ error: "invalid_text" });
      const deps = operatorDeps(body.data.confirmRisk);
      return respondWithSend(reply, () => inbox.sendFromOperator(params.data.id, body.data.text, deps), 201);
    });

    app.post("/api/messages/:id/retry", async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) return notFound(reply);
      const body = retryBody.safeParse(req.body ?? {});
      const deps = operatorDeps(body.success ? body.data.confirmRisk : undefined);
      return respondWithSend(reply, () => inbox.retry(params.data.id, deps), 200);
    });
  };
}

async function respondWithSend(
  reply: FastifyReply,
  run: () => Promise<{ status: string } & Parameters<typeof presentMessage>[0]>,
  okStatus: number,
) {
  try {
    const message = await run();
    return reply.code(message.status === "failed" ? 502 : okStatus).send({ message: presentMessage(message) });
  } catch (err) {
    if (err instanceof InboxError) return reply.code(STATUS_BY_CODE[err.code]).send({ error: err.code, ...err.details });
    throw err;
  }
}
