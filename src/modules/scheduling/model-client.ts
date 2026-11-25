/** Cliente de modelo por API compatível com OpenAI (chat/completions) e escolha do provedor por variáveis de ambiente. */

import { createOllamaClient, InterpreterUnavailable, type OllamaClient } from "./ollama.js";

/** Contadores de uma rodada: chamadas feitas, respostas 429 recebidas (inclusive as repetidas) e chamadas que terminaram em falha. */
export type ModelStats = { calls: number; rateLimited: number; failed: number };

/** Mesmo formato do cliente do Ollama: quem aceita `Pick<OllamaClient, "chat">` aceita os dois. `stats` vem dos clientes da fábrica. */
export type ModelClient = { model: string; chat: OllamaClient["chat"]; stats?: () => ModelStats };

type ChatArgs = Parameters<OllamaClient["chat"]>[0];

const MAX_ATTEMPTS = 5;
const BASE_WAIT_MS = 2000;
const MAX_WAIT_MS = 30000;
const MAX_JITTER = 0.25;
const MINUTE_MS = 60000;
const DEFAULT_BURST = 4;
const DEFAULT_MAX_TOKENS = 1024;
const ERROR_SNIPPET_LENGTH = 200;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Espera pedida pelo cabeçalho retry-after (em segundos), limitada a 30 s; sem cabeçalho válido, undefined. */
function retryAfterMs(res: Response): number | undefined {
  const value = res.headers.get("retry-after");
  const seconds = Number(value);
  if (value === null || !Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_WAIT_MS);
}

/** Espera após o 429 de índice retryIndex (0 = primeiro): o maior entre retry-after e o recuo 2 s, 4 s, 8 s…, mais jitter, sempre no máximo 30 s. */
function backoffWaitMs(res: Response, retryIndex: number, jitter: () => number): number {
  const exponential = BASE_WAIT_MS * 2 ** retryIndex;
  const base = Math.max(retryAfterMs(res) ?? 0, exponential);
  return Math.min(base * (1 + jitter()), MAX_WAIT_MS);
}

/** Corpo do erro sem a chave de API e cortado, para não vazar segredo nem encher o log. */
async function errorSnippet(res: Response, apiKey: string): Promise<string> {
  const body = await res.text().catch(() => "");
  const withoutKey = apiKey ? body.split(apiKey).join("***") : body;
  return withoutKey.slice(0, ERROR_SNIPPET_LENGTH);
}

async function post(
  doFetch: typeof fetch,
  url: string,
  body: string,
  apiKey: string,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new InterpreterUnavailable(`modelo inacessível: ${(err as Error).message}`, { cause: err });
  }
}

/** Devolve o JSON do conteúdo gerado, ou null se vier vazio ou não for JSON (quem chamou trata como "não entendi"). */
async function readContent(res: Response): Promise<unknown> {
  let data: { choices?: { message?: { content?: unknown } }[] };
  try {
    data = await res.json();
  } catch (err) {
    throw new InterpreterUnavailable("resposta do modelo não é JSON", { cause: err });
  }
  const content = data?.choices?.[0]?.message?.content;
  // Modelos de raciocínio podem gastar todos os tokens pensando e voltar sem conteúdo
  if (typeof content !== "string" || content.trim() === "") return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function createOpenAICompatClient({
  baseUrl,
  apiKey,
  model,
  timeoutMs,
  extraBody,
  maxTokens,
  maxPerMinute,
  burst,
  fetch: doFetch = fetch,
  sleep = wait,
  now = Date.now,
  jitter = () => Math.random() * MAX_JITTER,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Campos específicos do provedor (ex.: chat_template_kwargs); entram por último e podem sobrescrever os padrões. */
  extraBody?: Record<string, unknown>;
  maxTokens?: number;
  /** Limite de tentativas HTTP por minuto (balde de fichas), repetidas após 429 incluídas; sem valor, sem limite. */
  maxPerMinute?: number;
  /** Fichas do balde: rajada de chamadas seguidas sem espera. O provedor limita rajadas, então o padrão é pequeno (4). */
  burst?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Fração (0 a 0,25) somada ao recuo após cada 429; os testes injetam () => 0 para ter esperas exatas. */
  jitter?: () => number;
}): ModelClient {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const counters: ModelStats = { calls: 0, rateLimited: 0, failed: 0 };
  // Balde de fichas em unidades de "ficha × ms" (uma ficha vale MINUTE_MS): cada ms repõe maxPerMinute, e a conta fica inteira
  const capacity = (burst ?? DEFAULT_BURST) * MINUTE_MS;
  let units = capacity;
  let lastRefill = now();

  /** Balde de fichas: repõe o tempo passado até a capacidade, gasta uma ficha e, se faltar, espera até ela existir. A conta é feita na hora da chamada, então quem chega antes entra antes na fila. */
  async function waitForSlot(): Promise<void> {
    if (!maxPerMinute) return;
    const current = now();
    units = Math.min(capacity, units + (current - lastRefill) * maxPerMinute);
    lastRefill = current;
    units -= MINUTE_MS;
    if (units >= 0) return;
    await sleep(Math.ceil(-units / maxPerMinute));
  }

  /** Uma tentativa HTTP: passa pelo limitador e conta cada 429 recebido. */
  async function attempt(body: string): Promise<Response> {
    await waitForSlot();
    const res = await post(doFetch, url, body, apiKey, timeoutMs);
    if (res.status === 429) counters.rateLimited++;
    return res;
  }

  async function send({ messages, format, temperature = 0 }: ChatArgs): Promise<unknown> {
    const body = JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      response_format: { type: "json_schema", json_schema: { name: "reply", schema: format, strict: true } },
      ...extraBody,
    });

    let res = await attempt(body);
    for (let retryIndex = 0; res.status === 429 && retryIndex < MAX_ATTEMPTS - 1; retryIndex++) {
      await sleep(backoffWaitMs(res, retryIndex, jitter));
      res = await attempt(body);
    }
    if (res.status === 429) {
      throw new InterpreterUnavailable(`limite de requisições do modelo atingido (429) após ${MAX_ATTEMPTS} tentativas`);
    }
    if (!res.ok) {
      throw new InterpreterUnavailable(`modelo respondeu ${res.status}: ${await errorSnippet(res, apiKey)}`);
    }
    return readContent(res);
  }

  return {
    model,
    stats: () => ({ ...counters }),
    /** `temperature` 0 (padrão) para interpretar, como no cliente do Ollama. */
    async chat(args: ChatArgs): Promise<unknown> {
      counters.calls++;
      try {
        return await send(args);
      } catch (err) {
        if (err instanceof InterpreterUnavailable) counters.failed++;
        throw err;
      }
    },
  };
}

/** Ollama local não tem limite de requisições: só conta chamadas, 429 e falhas, e repassa `chat` sem mudar nada. */
function withCounters(client: Pick<ModelClient, "model" | "chat">): ModelClient {
  const counters: ModelStats = { calls: 0, rateLimited: 0, failed: 0 };
  return {
    model: client.model,
    stats: () => ({ ...counters }),
    async chat(args: ChatArgs): Promise<unknown> {
      counters.calls++;
      try {
        return await client.chat(args);
      } catch (err) {
        if (err instanceof InterpreterUnavailable) {
          counters.failed++;
          // ollama.ts põe o status HTTP na mensagem: "Ollama respondeu 429: ..."
          if (/respondeu 429\b/.test(err.message)) counters.rateLimited++;
        }
        throw err;
      }
    },
  };
}

/** Provedores aceitos em MODEL_PROVIDER. "openai-compatible" é o protocolo (qualquer servidor que fala chat/completions), não uma empresa. */
export const MODEL_PROVIDERS = ["ollama", "openai-compatible", "nvidia"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/** Padrões de um provedor conhecido: cada MODEL_* do ambiente, e AGENT_TIMEOUT_MS, substitui o seu. */
export type ProviderPreset = {
  baseUrl: string;
  model: string;
  /** Substituído inteiro por MODEL_EXTRA_BODY quando esta variável está definida. */
  extraBody?: Record<string, unknown>;
  maxPerMinute: number;
  timeoutMs: number;
};

export const PROVIDER_PRESETS: Partial<Record<ModelProvider, ProviderPreset>> = {
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
    maxPerMinute: 35,
    timeoutMs: 60000,
  },
};

const DEFAULT_TIMEOUT_MS = 20000;

export type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  extraBody?: Record<string, unknown>;
  maxTokens?: number;
  maxPerMinute?: number;
};

function isModelProvider(value: string): value is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(value);
}

/** Recusa MODEL_PROVIDER=nvidia em produção (LGPD). Devolve a mensagem de recusa, ou undefined se o provedor pode rodar. */
export function assertProviderAllowed(provider: string, nodeEnv: string | undefined): string | undefined {
  if (provider !== "nvidia" || nodeEnv !== "production") return undefined;
  return "MODEL_PROVIDER=nvidia não pode rodar com NODE_ENV=production: o nível gratuito do NVIDIA Build é só para desenvolvimento e avaliação e não pode receber conversas reais de pacientes (LGPD)";
}

/** Junta o provedor com o ambiente: MODEL_* e AGENT_TIMEOUT_MS do ambiente vencem o preset. Erros nomeiam variáveis, nunca valores. */
export function resolveOpenAICompatibleConfig(
  env: Record<string, string | undefined>,
  provider: Exclude<ModelProvider, "ollama">,
): OpenAICompatibleConfig {
  const preset: Partial<ProviderPreset> = PROVIDER_PRESETS[provider] ?? {};
  const baseUrl = env.MODEL_BASE_URL ?? preset.baseUrl;
  const apiKey = env.MODEL_API_KEY;
  const model = env.MODEL_NAME ?? preset.model;
  if (!baseUrl || !apiKey || !model) {
    const missing = [
      ["MODEL_BASE_URL", baseUrl],
      ["MODEL_API_KEY", apiKey],
      ["MODEL_NAME", model],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    throw new Error(`MODEL_PROVIDER=${provider} precisa das variáveis: ${missing.join(", ")}`);
  }
  return {
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number(env.AGENT_TIMEOUT_MS ?? preset.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    extraBody: env.MODEL_EXTRA_BODY ? parseExtraBody(env.MODEL_EXTRA_BODY) : preset.extraBody,
    maxTokens: env.MODEL_MAX_TOKENS ? Number(env.MODEL_MAX_TOKENS) : undefined,
    maxPerMinute: env.MODEL_MAX_PER_MINUTE ? Number(env.MODEL_MAX_PER_MINUTE) : preset.maxPerMinute,
  };
}

/** Lê o provedor e as credenciais do ambiente. Erros dizem o nome das variáveis, nunca o valor. */
export function createModelClientFromEnv(
  env: Record<string, string | undefined>,
  { fetch: doFetch }: { fetch?: typeof fetch } = {},
): ModelClient {
  const provider = env.MODEL_PROVIDER ?? "ollama";
  if (!isModelProvider(provider)) {
    throw new Error(`MODEL_PROVIDER desconhecido: ${provider} (use ${MODEL_PROVIDERS.map((p) => `"${p}"`).join(", ")})`);
  }

  if (provider === "ollama") {
    return withCounters(
      createOllamaClient({
        url: env.OLLAMA_URL ?? "http://127.0.0.1:11434",
        model: env.MODEL_NAME ?? env.AGENT_MODEL ?? "qwen3:8b",
        timeoutMs: Number(env.AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
        fetch: doFetch,
      }),
    );
  }

  return createOpenAICompatClient({ ...resolveOpenAICompatibleConfig(env, provider), fetch: doFetch });
}

function parseExtraBody(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new Error("MODEL_EXTRA_BODY não é JSON válido", { cause: err });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("MODEL_EXTRA_BODY precisa ser um objeto JSON");
  }
  return value as Record<string, unknown>;
}
