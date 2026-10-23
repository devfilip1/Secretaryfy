import type { AntibanConfig } from "./limits.js";

export interface AssessedMessage {
  origin: "customer" | "assistant" | "operator" | "phone" | "system";
  status: "received" | "sending" | "sent" | "failed" | "blocked";
  sentAt: Date;
}

export type Assessment = "ok" | "too_many_unanswered" | "loop";

type Limits = Pick<AntibanConfig, "maxUnanswered" | "loopFastReplyMs" | "loopFastReplies" | "loopBurst" | "loopBurstWindowMs">;

const fromAssistant = (m: AssessedMessage) => m.origin === "assistant" && (m.status === "sent" || m.status === "sending");

/**
 * Antes de mais uma resposta do assistente: ele já insistiu demais sem resposta do cliente, ou a conversa parece
 * um laço com outro robô? `messages` em ordem cronológica, sem registros do sistema (research.md R5; FR-013, FR-014).
 */
export function assessConversation(messages: AssessedMessage[], now: Date, limits: Limits): Assessment {
  // Laço por volume: muitas respostas do assistente em pouco tempo
  const since = now.getTime() - limits.loopBurstWindowMs;
  const burst = messages.filter((m) => fromAssistant(m) && m.sentAt.getTime() >= since).length;
  if (burst >= limits.loopBurst) return "loop";

  // Laço por resposta rápida: o contato respondeu sempre em segundos às últimas mensagens do assistente
  let fastReplies = 0;
  for (let i = messages.length - 1; i > 0 && fastReplies < limits.loopFastReplies; i--) {
    const reply = messages[i];
    if (reply.origin !== "customer") continue;
    const previous = messages[i - 1];
    if (!fromAssistant(previous)) break;
    if (reply.sentAt.getTime() - previous.sentAt.getTime() >= limits.loopFastReplyMs) break;
    fastReplies++;
    i--;
  }
  if (fastReplies >= limits.loopFastReplies) return "loop";

  // Insistência: mensagens do assistente depois da última do cliente
  let unanswered = 0;
  for (let i = messages.length - 1; i >= 0 && messages[i].origin !== "customer"; i--) {
    if (fromAssistant(messages[i])) unanswered++;
  }
  if (unanswered >= limits.maxUnanswered) return "too_many_unanswered";

  return "ok";
}
