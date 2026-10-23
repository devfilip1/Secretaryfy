import type { AntibanConfig } from "./limits.js";
import type { AntibanRepository } from "./repository.js";

export type BreakerReason = "send_failures" | "connection_drops";

export interface BreakerState {
  paused: boolean;
  pausedUntil: Date | null;
  reason: BreakerReason | null;
}

/**
 * Freio automático: falhas de envio ou quedas de conexão demais numa janela pausam os envios automáticos
 * (research.md R11; FR-026). As ocorrências ficam em memória; a pausa, no banco, para sobreviver a um reinício.
 */
export function createBreaker({
  repo,
  config,
  now = () => new Date(),
  onChange = () => {},
}: {
  repo: Pick<AntibanRepository, "getProtectionState" | "setPaused">;
  config: Pick<AntibanConfig, "breakerFailures" | "breakerFailureWindowMs" | "breakerDrops" | "breakerDropWindowMs" | "breakerPauseMs">;
  now?: () => Date;
  onChange?: (state: BreakerState) => void;
}) {
  const failures: number[] = [];
  const drops: number[] = [];

  function keepWindow(list: number[], windowMs: number) {
    const since = now().getTime() - windowMs;
    while (list.length && list[0] < since) list.shift();
  }

  async function trip(reason: BreakerReason) {
    if ((await breaker.current()).paused) return;
    const until = new Date(now().getTime() + config.breakerPauseMs);
    await repo.setPaused(until, reason);
    failures.length = 0;
    drops.length = 0;
    onChange({ paused: true, pausedUntil: until, reason });
  }

  const breaker = {
    async recordFailure() {
      failures.push(now().getTime());
      keepWindow(failures, config.breakerFailureWindowMs);
      if (failures.length >= config.breakerFailures) await trip("send_failures");
    },

    async recordDrop() {
      drops.push(now().getTime());
      keepWindow(drops, config.breakerDropWindowMs);
      if (drops.length >= config.breakerDrops) await trip("connection_drops");
    },

    /** Estado atual; a primeira consulta depois do prazo encerra a pausa e avisa. */
    async current(): Promise<BreakerState> {
      const row = await repo.getProtectionState();
      if (!row?.pausedUntil) return { paused: false, pausedUntil: null, reason: null };
      if (row.pausedUntil > now()) return { paused: true, pausedUntil: row.pausedUntil, reason: row.reason ?? null };
      await repo.setPaused(null, null);
      const resumed = { paused: false, pausedUntil: null, reason: null };
      onChange(resumed);
      return resumed;
    },
  };
  return breaker;
}

export type Breaker = ReturnType<typeof createBreaker>;
