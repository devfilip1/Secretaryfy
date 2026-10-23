/** Motivos de uma mensagem que a proteção não enviou (data-model.md#messages). */
export type BlockReason =
  | "outside_window"
  | "rate_limited"
  | "daily_conversations"
  | "unanswered"
  | "loop"
  | "duplicate"
  | "opted_out"
  | "paused"
  | "restart"
  | "superseded";

export type QueueOutcome<T> = { ok: true; value: T } | { ok: false; reason: BlockReason };

export interface QueueJob<T> {
  /** Depois disto a mensagem ficou velha demais e não sai (FR-012). */
  expiresAt: Date;
  /** Verificação na hora de sair: um motivo impede o envio. */
  check?: () => Promise<BlockReason | null>;
  run: () => Promise<T>;
}

interface Pending<T> {
  job: QueueJob<T>;
  resolve: (outcome: QueueOutcome<T>) => void;
  reject: (err: unknown) => void;
}

/**
 * Fila dos envios do número: um de cada vez, na ordem de chegada (research.md R2). `waitForSlot` espera a vaga
 * nos limites e devolve false se ela só viria depois do prazo da mensagem.
 */
export function createSendQueue({ now, waitForSlot }: { now: () => Date; waitForSlot: (deadline: Date) => Promise<boolean> }) {
  const pending: Pending<unknown>[] = [];
  let working = false;

  async function process<T>(job: QueueJob<T>): Promise<QueueOutcome<T>> {
    if (now() > job.expiresAt || !(await waitForSlot(job.expiresAt))) return { ok: false, reason: "rate_limited" };
    const reason = await job.check?.();
    if (reason) return { ok: false, reason };
    return { ok: true, value: await job.run() };
  }

  async function work() {
    if (working) return;
    working = true;
    try {
      for (let next = pending.shift(); next; next = pending.shift()) {
        await process(next.job).then(next.resolve, next.reject);
      }
    } finally {
      working = false;
    }
  }

  return {
    enqueue<T>(job: QueueJob<T>): Promise<QueueOutcome<T>> {
      return new Promise<QueueOutcome<T>>((resolve, reject) => {
        pending.push({ job, resolve, reject } as Pending<unknown>);
        void work();
      });
    },

    /** O freio disparou: nada do que espera na fila sai (FR-027). */
    drain(reason: BlockReason) {
      for (const item of pending.splice(0)) item.resolve({ ok: false, reason });
    },

    size(): number {
      return pending.length;
    },
  };
}

export type SendQueue = ReturnType<typeof createSendQueue>;
