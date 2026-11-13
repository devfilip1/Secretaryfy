import type { FastifyBaseLogger } from "fastify";
import type { Gate } from "../antiban/gate.js";
import type { BlockReason } from "../antiban/queue.js";
import { matchCommand } from "../antiban/opt-out.js";
import type { FixedTexts } from "../antiban/texts.js";
import type { SystemNote } from "../inbox/system-note.js";
import type { ConversationTurn, RagAnswer } from "../rag/client.js";
import type { IncomingMessage } from "./evolution.js";

/**
 * O texto a enviar. `ignorePause` vale para a resposta de quem acabou de pausar a conversa (handoff, specs/003 FR-024a).
 * `split`: o texto é do folheto e pode sair em até MAX_PARTS mensagens, uma por parágrafo, como alguém digitando.
 * `followUp`: mais uma mensagem depois da resposta, como o pedido de nome (specs/005); conta no limite de MAX_PARTS.
 */
export interface Reply {
  text: string;
  ignorePause?: boolean;
  split?: boolean;
  followUp?: string;
}

/** No máximo três mensagens seguidas por resposta (abaixo do limite de insistência da proteção, ANTIBAN_MAX_UNANSWERED) */
export const MAX_PARTS = 3;

/** Quantas mensagens anteriores da conversa vão para o folheto resolver "it", "that one", "how much?" */
const RAG_HISTORY_LIMIT = 6;

/** Acima disto, um parágrafo único é um bloco grande demais para uma mensagem só */
const LONG_PART_CHARS = 180;

/**
 * Separa a resposta em mensagens pelos parágrafos (linha em branco); o que passar de `maxParts` vai na última.
 * Se o modelo escreveu tudo num bloco só e longo, separa pelas frases.
 */
export function splitReply(text: string, maxParts = MAX_PARTS): string[] {
  const parts = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [text];
  if (parts.length === 1 && parts[0].length > LONG_PART_CHARS) return bySentences(parts[0], maxParts);
  if (parts.length <= maxParts) return parts;
  return [...parts.slice(0, maxParts - 1), parts.slice(maxParts - 1).join("\n")];
}

/** Frases agrupadas em até `maxParts` mensagens de tamanho parecido, sem quebrar nenhuma frase. */
function bySentences(text: string, maxParts: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
  const count = Math.min(maxParts, sentences.length, Math.ceil(text.length / LONG_PART_CHARS));
  if (count <= 1) return [text];
  const target = text.length / count;
  const groups: string[] = [];
  let current = "";
  sentences.forEach((sentence, i) => {
    current = current ? `${current} ${sentence}` : sentence;
    const left = sentences.length - i - 1;
    // Fecha o grupo ao chegar no tamanho, deixando ao menos uma frase para cada grupo que falta
    if (groups.length < count - 1 && left >= count - 1 - groups.length && (current.length >= target || left === count - 1 - groups.length)) {
      groups.push(current);
      current = "";
    }
  });
  if (current) groups.push(current);
  return groups;
}

/** Decide a resposta de uma mensagem do cliente: o folheto (RAG) ou o agendamento (specs/003, scheduling/router.ts). */
export type Replier = (
  input: { conversationId: string; message: IncomingMessage },
  log: FastifyBaseLogger,
) => Promise<Reply | null>;

/** Resposta do folheto; com o assistente fora do ar, a mensagem de indisponibilidade. */
export function createRagAnswerer(
  ask: (question: string, history?: ConversationTurn[]) => Promise<RagAnswer>,
  options: { readonly unavailable: string },
) {
  return async function answerQuestion(
    question: string,
    log: FastifyBaseLogger,
    phone: string,
    history: ConversationTurn[] = [],
  ): Promise<string> {
    try {
      const result = await ask(question, history.slice(-RAG_HISTORY_LIMIT));
      log.info({ phone, latency_s: result.latency_s }, "resposta do assistente");
      return result.answer;
    } catch (err) {
      log.error({ phone, err }, "assistente indisponível");
      // Lido no erro, não na criação: a troca de língua pelo painel vale na próxima falha
      return options.unavailable;
    }
  };
}

/** Só o folheto, como na feature 001 (usado quando não há agendamento). */
export function createRagReplier(ask: (question: string) => Promise<RagAnswer>, options: { unavailable: string }): Replier {
  const answer = createRagAnswerer(ask, options);
  return async ({ message }, log) => ({ text: await answer(message.text ?? "", log, message.phone), split: true });
}

/** A primeira palavra, em minúsculas e sem pontuação: "Claro!" e "Claro, sim" começam com a mesma palavra */
const firstWord = (text: string) => text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") ?? "";

interface Deps {
  reply: Replier;
  /** Todo envio passa pela proteção do número (specs/004) */
  gate: Pick<Gate, "sendAssistant" | "pickVariant">;
  inbox: {
    isPaused(conversationId: string): Promise<boolean>;
    isOptedOut(phone: string): Promise<boolean>;
    setOptedOut(conversationId: string, optedOut: boolean, note: SystemNote): Promise<unknown>;
  };
  /** Há um agendamento em andamento? Nele, "cancelar" é do agendamento e não um pedido de saída */
  /** Textos fixos na língua da clínica */
  texts: FixedTexts;
  hasSchedulingSession?: (conversationId: string) => Promise<boolean>;
}

/**
 * Responde uma mensagem do cliente com o assistente, registrando a resposta.
 * Pedidos de saída e de volta são tratados antes de tudo, sem depender do modelo (specs/004 FR-019 a FR-021).
 * Respeita a pausa da conversa antes de decidir e de novo antes de enviar. Nunca rejeita: as falhas vão para o log.
 */
export function createMessageHandler({ reply, gate, inbox, hasSchedulingSession = async () => false, texts }: Deps) {
  /** As partes que o cliente não recebeu há pouco (a mesma janela da regra de texto repetido do portão). */
  async function keepFresh(conversationId: string, parts: string[]) {
    const fresh: string[] = [];
    for (const part of parts) if (await gate.pickVariant(conversationId, [part])) fresh.push(part);
    return fresh;
  }

  /**
   * O texto como o portão o deixa sair: ele mesmo, ou com uma abertura que o cliente ainda não recebeu; null se nenhuma serve.
   * Usa a mesma janela e a mesma conta da regra de texto repetido, então nunca difere do que o portão barraria.
   */
  async function unrepeated(conversationId: string, text: string): Promise<string | null> {
    const same = await gate.pickVariant(conversationId, [text]);
    // Uma abertura cuja primeira palavra já abre o texto ("Claro!" antes de "Claro! Tenho…") não entra: não se repete
    const openings = texts.again.filter((opening) => firstWord(opening) !== firstWord(text));
    return same ?? gate.pickVariant(conversationId, openings.map((opening) => `${opening}\n${text}`));
  }

  return async function handleMessage(
    { conversationId, message }: { conversationId: string; message: IncomingMessage },
    log: FastifyBaseLogger,
    burst: { waited: boolean } = { waited: false },
  ): Promise<void> {
    const { phone } = message;
    if (message.type !== "text" || !message.text) return;
    // Uma rodada que esperou outra resposta desta conversa é o cliente escrevendo enquanto respondíamos: não é insistência
    const insistence: BlockReason[] = burst.waited ? ["unanswered"] : [];

    try {
      const command = matchCommand(message.text, { inSchedulingFlow: await hasSchedulingSession(conversationId) });
      const optedOut = await inbox.isOptedOut(phone);

      if (command === "opt_out") {
        if (optedOut) return;
        await inbox.setOptedOut(conversationId, true, { kind: "opted_out" });
        // Uma única confirmação, mesmo com a conversa pausada pelo operador
        const text = await gate.pickVariant(conversationId, texts.optOutConfirmation);
        if (text) await gate.sendAssistant({ conversationId, phone, text, ignorePause: true, bypass: ["opted_out", "unanswered"] });
        return;
      }
      if (command === "opt_in" && optedOut) {
        await inbox.setOptedOut(conversationId, false, { kind: "opted_in" });
        const text = await gate.pickVariant(conversationId, texts.optIn);
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

      if (texts.unavailable.includes(answer.text)) {
        const text = await gate.pickVariant(conversationId, texts.unavailable);
        if (!text) {
          log.info({ conversationId }, "indisponibilidade já avisada a este cliente");
          return;
        }
        await gate.sendAssistant({ conversationId, phone, text, ignorePause: answer.ignorePause });
        return;
      }
      // Uma parte que o cliente acabou de receber ("Hi!" de novo) é pulada, para não barrar a resposta inteira
      // O followUp ocupa uma das MAX_PARTS mensagens e sai por último
      const room = answer.followUp ? MAX_PARTS - 1 : MAX_PARTS;
      const parts = answer.split ? splitReply(answer.text, room) : [answer.text];
      const fresh = parts.length > 1 ? await keepFresh(conversationId, parts) : parts;
      // Todas as partes repetidas: a resposta inteira sai numa mensagem só, com abertura, nunca em silêncio
      const pieces = fresh.length > 0 ? fresh : [parts.join("\n")];
      if (fresh.length === 0) log.info({ conversationId }, "todas as partes repetidas: resposta inteira, com abertura");
      // Uma mensagem de cada vez, cada uma com seu "digitando…"; se uma não sair, as seguintes também não
      for (const piece of answer.followUp ? [...pieces, answer.followUp] : pieces) {
        const text = await unrepeated(conversationId, piece);
        // ponytail: teto = as três aberturas já enviadas para este mesmo texto na janela; então só o log, sem outra saída
        if (!text) {
          log.error({ conversationId }, "resposta repetida sem abertura livre: não enviada");
          return;
        }
        if ((await gate.sendAssistant({ conversationId, phone, text, ignorePause: answer.ignorePause, bypass: insistence })) !== "sent") return;
      }
    } catch (err) {
      log.error({ phone, err }, "falha ao registrar a resposta do assistente");
    }
  };
}
