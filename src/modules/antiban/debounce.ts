/**
 * Espera um silêncio do cliente antes de responder: cada mensagem nova da conversa reinicia o temporizador,
 * e só a última dispara a resposta (research.md R4; FR-007).
 */
export function createDebouncer<T>({
  delayMs,
  onFire,
  setTimeout: later = setTimeout,
  clearTimeout: cancelLater = clearTimeout,
}: {
  delayMs: number;
  onFire: (conversationId: string, payload: T) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (timer: never) => void;
}) {
  const timers = new Map<string, unknown>();

  return {
    push(conversationId: string, payload: T) {
      const current = timers.get(conversationId);
      if (current !== undefined) cancelLater(current as never);
      timers.set(
        conversationId,
        later(() => {
          timers.delete(conversationId);
          onFire(conversationId, payload);
        }, delayMs),
      );
    },

    /** O operador respondeu: a resposta pendente do assistente não acontece. */
    cancel(conversationId: string) {
      const current = timers.get(conversationId);
      if (current !== undefined) cancelLater(current as never);
      timers.delete(conversationId);
    },

    pending(): number {
      return timers.size;
    },
  };
}

export type Debouncer<T> = ReturnType<typeof createDebouncer<T>>;
