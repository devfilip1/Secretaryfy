import type { FastifyBaseLogger } from "fastify";
import type { Gate } from "../antiban/gate.js";
import { matchCommand } from "../antiban/opt-out.js";
import { fixedTexts, protectionNotes } from "../antiban/texts.js";
import type { RagAnswer } from "../rag/client.js";
import type { IncomingMessage } from "./evolution.js";

/** Em inglês, como as respostas do assistente da DentalSafe. Na hora de enviar, vira uma das variações (specs/004 FR-017). */
export const UNAVAILABLE_MESSAGE = fixedTexts.unavailable[0];

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
  /** Todo envio passa pela proteção do número (specs/004) */
  gate: Pick<Gate, "sendAssistant" | "pickVariant">;
  inbox: {
    isPaused(conversationId: string): Promise<boolean>;
    isOptedOut(phone: string): Promise<boolean>;
    setOptedOut(conversationId: string, optedOut: boolean, note: string): Promise<unknown>;
  };
  /** Há um agendamento em andamento? Nele, "cancelar" é do agendamento e não um pedido de saída */
  hasSchedulingSession?: (conversationId: string) => Promise<boolean>;
}

/**
 * Responde uma mensagem do cliente com o assistente, registrando a resposta.
 * Pedidos de saída e de volta são tratados antes de tudo, sem depender do modelo (specs/004 FR-019 a FR-021).
 * Respeita a pausa da conversa antes de decidir e de novo antes de enviar. Nunca rejeita: as falhas vão para o log.
 */
export function createMessageHandler({ reply, gate, inbox, hasSchedulingSession = async () => false }: Deps) {
  return async function handleMessage(
    { conversationId, message }: { conversationId: string; message: IncomingMessage },
    log: FastifyBaseLogger,
  ): Promise<void> {
    const { phone } = message;
    if (message.type !== "text" || !message.text) return;

    try {
      const command = matchCommand(message.text, { inSchedulingFlow: await hasSchedulingSession(conversationId) });
      const optedOut = await inbox.isOptedOut(phone);

      if (command === "opt_out") {
        if (optedOut) return;
        await inbox.setOptedOut(conversationId, true, protectionNotes.optedOut);
        // Uma única confirmação, mesmo com a conversa pausada pelo operador
        const text = await gate.pickVariant(conversationId, fixedTexts.optOutConfirmation);
        if (text) await gate.sendAssistant({ conversationId, phone, text, ignorePause: true, bypass: ["opted_out", "unanswered"] });
        return;
      }
      if (command === "opt_in" && optedOut) {
        await inbox.setOptedOut(conversationId, false, protectionNotes.optedIn);
        const text = await gate.pickVariant(conversationId, fixedTexts.optIn);
        if (text) await gate.sendAssistant({ conversationId, phone, text, ignorePause: true });
        return;
      }
      // Quem pediu para sair não recebe resposta; a mensagem continua no painel para o operador
      if (optedOut) return;

      if (await inbox.isPaused(conversationId)) return;

      const answer = await reply({ conversationId, message }, log);
      if (!answer) return;

      // O operador pode ter assumido a conversa enquanto o assistente pensava
      if (!answer.ignorePause && (await inbox.isPaused(conversationId))) {
        log.info({ phone }, "resposta descartada: conversa pausada");
        return;
      }

      let text: string | null = answer.text;
      if (fixedTexts.unavailable.includes(text)) {
        text = await gate.pickVariant(conversationId, fixedTexts.unavailable);
        if (!text) {
          log.info({ conversationId }, "indisponibilidade já avisada a este cliente");
          return;
        }
      }
      await gate.sendAssistant({ conversationId, phone, text, ignorePause: answer.ignorePause });
    } catch (err) {
      log.error({ phone, err }, "falha ao registrar a resposta do assistente");
    }
  };
}
