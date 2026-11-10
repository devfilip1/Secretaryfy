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
