/**
 * Fila única do processo para criar, mover e apagar eventos (research.md R9): dentro dela, a ocupação é lida de novo
 * antes de gravar. Basta enquanto o Secretaryfy roda num processo só; com mais de um, trocar por um lock no Postgres.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withCalendarLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // A próxima espera esta terminar, mesmo que ela falhe
  tail = run.catch(() => {});
  return run;
}
