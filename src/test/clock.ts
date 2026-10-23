// Relógio falso para os testes da proteção (specs/004): `setTimeout` só dispara quando `advance` passa do horário.

export function fakeClock(start = new Date("2026-10-18T12:00:00Z")) {
  let current = start.getTime();
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();

  const clock = {
    now: () => new Date(current),
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: current + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id: never) => {
      timers.delete(id as unknown as number);
    },
    /** Avança o relógio disparando, em ordem, os temporizadores vencidos (e os que eles criarem). */
    async advance(ms: number) {
      const target = current + ms;
      for (;;) {
        await flush();
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        current = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      current = target;
      await flush();
    },
    pendingTimers: () => timers.size,
  };
  return clock;
}

/** Deixa as promessas pendentes andarem (várias voltas, para cadeias de await). */
export async function flush() {
  for (let i = 0; i < 50; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}
