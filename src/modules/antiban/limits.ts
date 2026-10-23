import type { env as appEnv } from "../../config/env.js";

/** Configuração da proteção do número (specs/004, data-model.md#configuração). */
export interface AntibanConfig {
  /** Da última mensagem do cliente até ela aparecer como visualizada */
  readMinMs: number;
  readMaxMs: number;
  /** Entre visualizar e começar a digitar */
  thinkMinMs: number;
  thinkMaxMs: number;
  typingMinMs: number;
  typingMaxMs: number;
  debounceMs: number;
  perMinute: number;
  perHour: number;
  gapMinMs: number;
  gapMaxMs: number;
  conversationsPerDay: number;
  queueMaxAgeMs: number;
  maxUnanswered: number;
  loopFastReplyMs: number;
  loopFastReplies: number;
  loopBurst: number;
  loopBurstWindowMs: number;
  duplicateWindowMs: number;
  allowedLinkDomains: string[];
  warmupDays: number;
  warmupConversationsPerDay: number;
  warmupPerMinute: number;
  retryMinIntervalMs: number;
  breakerFailures: number;
  breakerFailureWindowMs: number;
  breakerDrops: number;
  breakerDropWindowMs: number;
  breakerPauseMs: number;
  qrAttempts: number;
  qrWindowMs: number;
}

export function configFromEnv(env: typeof appEnv): AntibanConfig {
  return {
    readMinMs: env.ANTIBAN_READ_MIN_MS,
    readMaxMs: env.ANTIBAN_READ_MAX_MS,
    thinkMinMs: env.ANTIBAN_THINK_MIN_MS,
    thinkMaxMs: env.ANTIBAN_THINK_MAX_MS,
    typingMinMs: env.ANTIBAN_TYPING_MIN_MS,
    typingMaxMs: env.ANTIBAN_TYPING_MAX_MS,
    debounceMs: env.ANTIBAN_DEBOUNCE_MS,
    perMinute: env.ANTIBAN_PER_MINUTE,
    perHour: env.ANTIBAN_PER_HOUR,
    gapMinMs: env.ANTIBAN_GAP_MIN_MS,
    gapMaxMs: env.ANTIBAN_GAP_MAX_MS,
    conversationsPerDay: env.ANTIBAN_CONVERSATIONS_PER_DAY,
    queueMaxAgeMs: env.ANTIBAN_QUEUE_MAX_AGE_MS,
    maxUnanswered: env.ANTIBAN_MAX_UNANSWERED,
    loopFastReplyMs: env.ANTIBAN_LOOP_FAST_REPLY_MS,
    loopFastReplies: env.ANTIBAN_LOOP_FAST_REPLIES,
    loopBurst: env.ANTIBAN_LOOP_BURST,
    loopBurstWindowMs: env.ANTIBAN_LOOP_BURST_WINDOW_MS,
    duplicateWindowMs: env.ANTIBAN_DUPLICATE_WINDOW_MS,
    allowedLinkDomains: env.ANTIBAN_ALLOWED_LINK_DOMAINS,
    warmupDays: env.ANTIBAN_WARMUP_DAYS,
    warmupConversationsPerDay: env.ANTIBAN_WARMUP_CONVERSATIONS_PER_DAY,
    warmupPerMinute: env.ANTIBAN_WARMUP_PER_MINUTE,
    retryMinIntervalMs: env.ANTIBAN_RETRY_MIN_INTERVAL_MS,
    breakerFailures: env.ANTIBAN_BREAKER_FAILURES,
    breakerFailureWindowMs: env.ANTIBAN_BREAKER_FAILURE_WINDOW_MS,
    breakerDrops: env.ANTIBAN_BREAKER_DROPS,
    breakerDropWindowMs: env.ANTIBAN_BREAKER_DROP_WINDOW_MS,
    breakerPauseMs: env.ANTIBAN_BREAKER_PAUSE_MS,
    qrAttempts: env.ANTIBAN_QR_ATTEMPTS,
    qrWindowMs: env.ANTIBAN_QR_WINDOW_MS,
  };
}

export interface Limits {
  perMinute: number;
  perHour: number;
  conversationsPerDay: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Limites em vigor agora. Número novo começa nos valores de aquecimento e chega aos normais em linha reta
 * ao fim de `warmupDays` (research.md R10). Sem data do primeiro uso, ou com aquecimento desligado, valem os normais.
 */
export function warmupLimits(
  config: AntibanConfig,
  firstConnectedAt: Date | null,
  now: Date,
): Limits & { warmupUntil: Date | null } {
  const normal = { perMinute: config.perMinute, perHour: config.perHour, conversationsPerDay: config.conversationsPerDay };
  if (!firstConnectedAt || config.warmupDays <= 0) return { ...normal, warmupUntil: null };

  const until = new Date(firstConnectedAt.getTime() + config.warmupDays * DAY_MS);
  if (now >= until) return { ...normal, warmupUntil: null };

  const progress = Math.max(0, (now.getTime() - firstConnectedAt.getTime()) / (config.warmupDays * DAY_MS));
  const ramp = (start: number, end: number) => Math.round(start + (end - start) * progress);
  const startPerHour = Math.round((config.perHour * config.warmupPerMinute) / Math.max(1, config.perMinute));
  return {
    perMinute: ramp(config.warmupPerMinute, config.perMinute),
    perHour: ramp(startPerHour, config.perHour),
    conversationsPerDay: ramp(config.warmupConversationsPerDay, config.conversationsPerDay),
    warmupUntil: until,
  };
}

/** Estado da proteção para o painel (contracts/panel-api.md#proteção-protectionjson). */
export interface ProtectionJson {
  state: "normal" | "warmup" | "paused";
  pausedUntil: string | null;
  reason: "send_failures" | "connection_drops" | null;
  warmupUntil: string | null;
  limits: Limits;
  usage: { lastMinute: number; lastHour: number; conversationsToday: number };
}
