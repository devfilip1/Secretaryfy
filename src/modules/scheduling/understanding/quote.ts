/** Texto para comparar: minúsculas, sem acento, pontuação vira espaço, espaços colapsados. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}/ ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A citação do cliente vale só se estiver na mensagem (comparada sem acento, caixa e pontuação); citação vazia nunca vale. */
export function quoted(text: string, quote: string | null): boolean {
  const q = quote ? normalize(quote) : "";
  return q.trim() !== "" && normalize(text).includes(q);
}

/**
 * A mesma regra para as mensagens do cliente: a citação tem de estar nas mensagens dele (a conversa e a atual). O que o
 * assistente disse não prova nada. Quem decide um tratamento citado usa esta função, sem outra conferência.
 */
export function quotedByCustomer(quote: string | null, history: { role: string; content: string }[], text: string): boolean {
  const said = [...history.filter((m) => m.role === "user").map((m) => m.content), text].map(normalize).join(" ");
  const q = quote ? normalize(quote) : "";
  return q.trim() !== "" && said.includes(q);
}
