// Carregado antes dos testes (npm test): preenche as variáveis obrigatórias de src/config/env.ts
// com valores falsos, para os módulos que importam `env` não encerrarem o processo.
const defaults: Record<string, string> = {
  PUBLIC_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  APP_SECRET: Buffer.alloc(32).toString("base64"),
  GOOGLE_CLIENT_ID: "test",
  GOOGLE_CLIENT_SECRET: "test",
  EVOLUTION_API_URL: "http://localhost:8080",
  EVOLUTION_API_KEY: "test",
  EVOLUTION_INSTANCE: "test",
  EVOLUTION_WEBHOOK_TOKEN: "test-webhook-token-0000",
  ANTHROPIC_API_KEY: "test",
  OPERATOR_PASSWORD: "test-operator-password",
  OLLAMA_URL: "http://ollama.test",
  AGENT_MODEL: "test-model",
  PANEL_URL: "http://panel.test",
};

for (const [name, value] of Object.entries(defaults)) {
  process.env[name] ??= value;
}
