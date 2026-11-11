/** Leitura de nomes: o nome limpo de uma resposta, o nome escrito na mensagem e "meu nome é X". */
import { normalize } from "../understanding/quote.js";

const NAME = /^[\p{L}][\p{L}'.-]*(?: [\p{L}][\p{L}'.-]*){0,3}$/u;
const MAX_NAME_CHARS = 60;
/** "my name is X" vale em qualquer momento */
export const MY_NAME = /^(?:(?:hi|hello|hey)[,!.]?\s+)?(?:my name is|my name's|call me|meu nome [eé]|me chamo)\s+(.+)$/i;

/** O nome escrito pelo cliente, limpo e com iniciais maiúsculas; null se não parecer um nome (contracts/interpreter.md). */
export function cleanName(raw: string | null | undefined): string | null {
  // Uma pergunta nunca é um nome, seja qual for a escrita
  if (raw?.includes("?")) return null;
  const text = (raw ?? "").replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, "").replace(/\.$/, "").replace(/\s+/g, " ").trim();
  // NAME aceita até 4 palavras
  if (!text || text.length > MAX_NAME_CHARS || !NAME.test(text)) return null;
  const words = text.split(" ");
  return words.map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase()).join(" ");
}

/** O nome tem de estar escrito na mensagem do cliente: o modelo às vezes inventa ou tira de uma pergunta. Compara sem acento e sem caixa. */
export function nameInText(name: string, text: string): boolean {
  const words = new Set(normalize(text).split(" "));
  return normalize(name).split(" ").every((w) => words.has(w));
}
