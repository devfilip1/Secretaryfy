/** Limita tentativas de login por IP: `maxFailures` falhas numa janela de `windowMs` bloqueiam até a janela passar. */
export function createLoginLimiter({
  maxFailures = 5,
  windowMs = 15 * 60_000,
  now = Date.now,
}: { maxFailures?: number; windowMs?: number; now?: () => number } = {}) {
  const failures = new Map<string, { count: number; since: number }>();

  function current(ip: string) {
    const entry = failures.get(ip);
    if (entry && now() - entry.since >= windowMs) {
      failures.delete(ip);
      return undefined;
    }
    return entry;
  }

  return {
    check(ip: string): { allowed: boolean; retryAfterS: number } {
      const entry = current(ip);
      if (!entry || entry.count < maxFailures) return { allowed: true, retryAfterS: 0 };
      return { allowed: false, retryAfterS: Math.ceil((entry.since + windowMs - now()) / 1000) };
    },
    fail(ip: string) {
      const entry = current(ip);
      if (entry) entry.count++;
      else failures.set(ip, { count: 1, since: now() });
    },
    succeed(ip: string) {
      failures.delete(ip);
    },
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
