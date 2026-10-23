// Pedidos de saída e de volta (contracts/conversation.md). Só conta a mensagem inteira igual a um item,
// para "não quero parar o tratamento" não virar saída (research.md R9).

const OPT_OUT = new Set([
  "parar",
  "pare",
  "para",
  "sair",
  "stop",
  "unsubscribe",
  "cancelar",
  "cancelar mensagens",
  "nao quero mais mensagens",
  "nao quero receber mensagens",
  "para de mandar mensagem",
  "para de me mandar mensagem",
  "remover",
  "me remove",
  "opt out",
  "opt-out",
  "optout",
]);

const OPT_IN = new Set(["voltar", "start", "quero voltar", "ativar", "subscribe"]);

/** Minúsculas, sem acentos, sem pontuação e emoji nas pontas, espaços colapsados. */
export function normalizeCommand(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * "opt_out", "opt_in" ou null. `cancelar` sozinho, com um agendamento em andamento, é do agendamento
 * (o cliente pode estar cancelando o horário), não um pedido de saída.
 */
export function matchCommand(text: string, { inSchedulingFlow }: { inSchedulingFlow: boolean }): "opt_out" | "opt_in" | null {
  const command = normalizeCommand(text);
  if (command === "cancelar" && inSchedulingFlow) return null;
  if (OPT_OUT.has(command)) return "opt_out";
  if (OPT_IN.has(command)) return "opt_in";
  return null;
}
