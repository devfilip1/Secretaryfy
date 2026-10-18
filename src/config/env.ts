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
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
