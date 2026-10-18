import type { FastifyBaseLogger } from "fastify";
import type { MessageRow } from "../../db/schema.js";
import type { SendResult } from "../inbox/service.js";
import type { RagAnswer } from "../rag/client.js";
import type { IncomingMessage } from "./evolution.js";

/** Em inglês, como as respostas do assistente da DentalSafe. */
export const UNAVAILABLE_MESSAGE =
  "Sorry, our virtual assistant is unavailable right now. Please try again in a few minutes.";

/** O texto a enviar. `ignorePause` vale para a resposta de quem acabou de pausar a conversa (handoff, specs/003 FR-024a). */
export interface Reply {
  text: string;
  ignorePause?: boolean;
}

/** Decide a resposta de uma mensagem do cliente: o folheto (RAG) ou o agendamento (specs/003, scheduling/router.ts). */
export type Replier = (
  input: { conversationId: string; message: IncomingMessage },
  log: FastifyBaseLogger,
) => Promise<Reply | null>;

/** Resposta do folheto; com o assistente fora do ar, a mensagem de indisponibilidade. */
export function createRagAnswerer(ask: (question: string) => Promise<RagAnswer>) {
  return async function answerQuestion(question: string, log: FastifyBaseLogger, phone: string): Promise<string> {
    try {
      const result = await ask(question);
      log.info({ phone, latency_s: result.latency_s }, "resposta do assistente");
      return result.answer;
    } catch (err) {
      log.error({ phone, err }, "assistente indisponível");
      return UNAVAILABLE_MESSAGE;
    }
  };
}

/** Só o folheto, como na feature 001 (usado quando não há agendamento). */
export function createRagReplier(ask: (question: string) => Promise<RagAnswer>): Replier {
  const answer = createRagAnswerer(ask);
  return async ({ message }, log) => ({ text: await answer(message.text ?? "", log, message.phone) });
}

interface Deps {
  reply: Replier;
  send: (phone: string, text: string) => Promise<{ waId: string }>;
  inbox: {
    isPaused(conversationId: string): Promise<boolean>;
    startOutgoing(v: { conversationId: string; origin: "assistant"; text: string }): Promise<MessageRow>;
    finishOutgoing(messageId: string, result: SendResult): Promise<unknown>;
  };
}

/**
 * Responde uma mensagem do cliente com o assistente, registrando a resposta.
 * Respeita a pausa da conversa antes de decidir e de novo antes de enviar. Nunca rejeita: as falhas vão para o log.
 */
export function createMessageHandler({ reply, send, inbox }: Deps) {
  return async function handleMessage(
    { conversationId, message }: { conversationId: string; message: IncomingMessage },
    log: FastifyBaseLogger,
  ): Promise<void> {
    const { phone } = message;
    if (message.type !== "text" || !message.text) return;

    try {
      if (await inbox.isPaused(conversationId)) return;

      const answer = await reply({ conversationId, message }, log);
      if (!answer) return;

      // O operador pode ter assumido a conversa enquanto o assistente pensava
      if (!answer.ignorePause && (await inbox.isPaused(conversationId))) {
        log.info({ phone }, "resposta descartada: conversa pausada");
        return;
      }

      const outgoing = await inbox.startOutgoing({ conversationId, origin: "assistant", text: answer.text });
      try {
        const { waId } = await send(phone, answer.text);
        await inbox.finishOutgoing(outgoing.id, { waId });
      } catch (err) {
        log.error({ phone, err }, "falha ao enviar pelo WhatsApp");
        await inbox.finishOutgoing(outgoing.id, { error: (err as Error).message });
      }
    } catch (err) {
      log.error({ phone, err }, "falha ao registrar a resposta do assistente");
    }
  };
}
