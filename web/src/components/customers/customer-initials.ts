/** Iniciais do avatar: a primeira letra do primeiro nome e, se houver, a do último sobrenome. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words.at(0)?.charAt(0) ?? "";
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase();
}
