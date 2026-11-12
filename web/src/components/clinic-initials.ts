/**
 * Iniciais do nome da clínica para o avatar: a primeira letra de até duas palavras.
 * Sem nome (vazio, só espaços ou ainda carregando) devolve null; quem chama mostra o texto neutro.
 */
export function clinicInitials(name: string | null | undefined): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .slice(0, 2)
    .map((word) => (Array.from(word)[0] ?? "").toLocaleUpperCase())
    .join("");
}
