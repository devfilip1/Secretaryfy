import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.url(),
  APP_SECRET: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "APP_SECRET deve ter 32 bytes em base64"),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  EVOLUTION_API_URL: z.url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1),
  EVOLUTION_WEBHOOK_TOKEN: z.string().min(16),
  // Endereço do servidor como a Evolution API o enxerga (ex.: host.docker.internal quando ela roda no Docker)
  WEBHOOK_BASE_URL: z.url().optional(),

  RAG_SERVICE_URL: z.url().default("http://127.0.0.1:8001"),
  RAG_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  ANTHROPIC_API_KEY: z.string().min(1),

  // Agendamento: o Ollama interpreta as mensagens do cliente (specs/003, research.md R2)
  OLLAMA_URL: z.url().default("http://127.0.0.1:11434"),
  AGENT_MODEL: z.string().min(1).default("llama3"),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  // Endereço do painel para a volta do OAuth do Google; sem a variável, vale PUBLIC_URL
  PANEL_URL: z.url().optional(),

  // Painel web: sem a senha, o painel fica desligado
  OPERATOR_PASSWORD: z.string().min(12, "OPERATOR_PASSWORD deve ter pelo menos 12 caracteres").optional(),
  DATABASE_URL_TEST: z.url().optional(),

  // Proteção do número contra banimento (specs/004, data-model.md#configuração)
  ANTIBAN_READ_MIN_MS: count(2000),
  ANTIBAN_READ_MAX_MS: count(8000),
  ANTIBAN_THINK_MIN_MS: count(1000),
  ANTIBAN_THINK_MAX_MS: count(3000),
  ANTIBAN_TYPING_MIN_MS: count(2000),
  ANTIBAN_TYPING_MAX_MS: count(12000),
  ANTIBAN_DEBOUNCE_MS: count(4000),
  ANTIBAN_PER_MINUTE: count(8),
  ANTIBAN_PER_HOUR: count(200),
  ANTIBAN_GAP_MIN_MS: count(2000),
  ANTIBAN_GAP_MAX_MS: count(6000),
  ANTIBAN_CONVERSATIONS_PER_DAY: count(150),
  ANTIBAN_QUEUE_MAX_AGE_MS: count(300000),
  ANTIBAN_MAX_UNANSWERED: count(3),
  ANTIBAN_LOOP_FAST_REPLY_MS: count(3000),
  ANTIBAN_LOOP_FAST_REPLIES: count(5),
  ANTIBAN_LOOP_BURST: count(20),
  ANTIBAN_LOOP_BURST_WINDOW_MS: count(600000),
  ANTIBAN_DUPLICATE_WINDOW_MS: count(1800000),
  ANTIBAN_ALLOWED_LINK_DOMAINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)),
  ANTIBAN_WARMUP_DAYS: count(14),
  ANTIBAN_WARMUP_CONVERSATIONS_PER_DAY: count(30),
  ANTIBAN_WARMUP_PER_MINUTE: count(4),
  ANTIBAN_RETRY_MIN_INTERVAL_MS: count(30000),
  ANTIBAN_BREAKER_FAILURES: count(5),
  ANTIBAN_BREAKER_FAILURE_WINDOW_MS: count(600000),
  ANTIBAN_BREAKER_DROPS: count(3),
  ANTIBAN_BREAKER_DROP_WINDOW_MS: count(1800000),
  ANTIBAN_BREAKER_PAUSE_MS: count(1800000),
  ANTIBAN_QR_ATTEMPTS: count(5),
  ANTIBAN_QR_WINDOW_MS: count(600000),
  // Lembrete pelo WhatsApp (specs/006): a partir de quanto antes do horário pode sair, até quanto antes, e o passo do agendador
  REMINDER_LEAD_MINUTES: count(1440),
  REMINDER_CUTOFF_MINUTES: count(120),
  REMINDER_TICK_MS: count(60000),
});

/** Inteiro não negativo com padrão. */
function count(fallback: number) {
  return z.coerce.number().int().nonnegative().default(fallback);
}

// Pares mínimo ≤ máximo, e aquecimento ≤ normal
const ANTIBAN_RANGES = [
  ["ANTIBAN_READ_MIN_MS", "ANTIBAN_READ_MAX_MS"],
  ["ANTIBAN_THINK_MIN_MS", "ANTIBAN_THINK_MAX_MS"],
  ["ANTIBAN_TYPING_MIN_MS", "ANTIBAN_TYPING_MAX_MS"],
  ["ANTIBAN_GAP_MIN_MS", "ANTIBAN_GAP_MAX_MS"],
  ["ANTIBAN_WARMUP_PER_MINUTE", "ANTIBAN_PER_MINUTE"],
  ["ANTIBAN_WARMUP_CONVERSATIONS_PER_DAY", "ANTIBAN_CONVERSATIONS_PER_DAY"],
] as const;

const parsed = envSchema
  .superRefine((v, ctx) => {
    for (const [low, high] of ANTIBAN_RANGES) {
      if (v[low] > v[high]) ctx.addIssue({ code: "custom", path: [low], message: `${low} não pode ser maior que ${high}` });
    }
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
