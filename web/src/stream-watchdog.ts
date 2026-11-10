/** Decide se o SSE está em silêncio: nenhum evento nem ping desde `lastActivity` por mais de `limit` ms. */
export function isSilent(now: number, lastActivity: number, limit: number): boolean {
  return now - lastActivity > limit;
}
