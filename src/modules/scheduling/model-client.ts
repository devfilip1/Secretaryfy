/** Cliente de modelo por API compatível com OpenAI (chat/completions) e escolha do provedor por variáveis de ambiente. */

import { createOllamaClient, InterpreterUnavailable, type OllamaClient } from "./ollama.js";

/** Contadores de uma rodada: chamadas feitas, respostas 429 recebidas (inclusive as repetidas) e chamadas que terminaram em falha. */
export type ModelStats = { calls: number; rateLimited: number; failed: number };

/** Mesmo formato do cliente do Ollama: quem aceita `Pick<OllamaClient, "chat">` aceita os dois. `stats` vem dos clientes da fábrica. */
export type ModelClient = { model: string; chat: OllamaClient["chat"]; stats?: () => ModelStats };

type ChatArgs = Parameters<OllamaClient["chat"]>[0];

const MAX_ATTEMPTS = 3;
const DEFAULT_WAIT_MS = 2000;
const MAX_WAIT_MS = 30000;
const MINUTE_MS = 60000;
const DEFAULT_MAX_TOKENS = 1024;
const ERROR_SNIPPET_LENGTH = 200;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Espera pedida pelo cabeçalho retry-after (em segundos), limitada a 30 s; sem cabeçalho válido, 2 s. */
function waitFromHeader(res: Response): number {
  const value = res.headers.get("retry-after");
  const seconds = Number(value);
  if (value === null || !Number.isFinite(seconds) || seconds < 0) return DEFAULT_WAIT_MS;
  return Math.min(seconds * 1000, MAX_WAIT_MS);
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
  fetch: doFetch = fetch,
  sleep = wait,
  now = Date.now,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Campos específicos do provedor (ex.: chat_template_kwargs); entram por último e podem sobrescrever os padrões. */
  extraBody?: Record<string, unknown>;
  maxTokens?: number;
  /** Limite de tentativas HTTP por minuto, repetidas após 429 incluídas; sem valor, sem limite. */
  maxPerMinute?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): ModelClient {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const spacingMs = maxPerMinute ? MINUTE_MS / maxPerMinute : 0;
  const counters: ModelStats = { calls: 0, rateLimited: 0, failed: 0 };
  // Próximo horário livre para uma tentativa; reservado na hora da chamada, então quem chega antes entra antes na fila
  let nextSlotAt = 0;

  /** Espera o próximo horário livre antes de cada tentativa HTTP. */
  async function waitForSlot(): Promise<void> {
    if (spacingMs === 0) return;
    const current = now();
    const slot = Math.max(current, nextSlotAt);
    nextSlotAt = slot + spacingMs;
    if (slot > current) await sleep(slot - current);
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
    for (let retry = 1; res.status === 429 && retry < MAX_ATTEMPTS; retry++) {
      await sleep(waitFromHeader(res));
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

/** Lê o provedor e as credenciais do ambiente. Erros dizem o nome das variáveis, nunca o valor. */
export function createModelClientFromEnv(
  env: Record<string, string | undefined>,
  { fetch: doFetch }: { fetch?: typeof fetch } = {},
): ModelClient {
  const provider = env.MODEL_PROVIDER ?? "ollama";
  const timeoutMs = Number(env.AGENT_TIMEOUT_MS ?? 20000);

  if (provider === "ollama") {
    return withCounters(
      createOllamaClient({
        url: env.OLLAMA_URL ?? "http://127.0.0.1:11434",
        model: env.MODEL_NAME ?? env.AGENT_MODEL ?? "qwen3:8b",
        timeoutMs,
        fetch: doFetch,
      }),
    );
  }

  if (provider === "openai") {
    const baseUrl = env.MODEL_BASE_URL;
    const apiKey = env.MODEL_API_KEY;
    const model = env.MODEL_NAME;
    if (!baseUrl || !apiKey || !model) {
      const missing = [
        ["MODEL_BASE_URL", baseUrl],
        ["MODEL_API_KEY", apiKey],
        ["MODEL_NAME", model],
      ]
        .filter(([, value]) => !value)
        .map(([name]) => name);
      throw new Error(`MODEL_PROVIDER=openai precisa das variáveis: ${missing.join(", ")}`);
    }
    return createOpenAICompatClient({
      baseUrl,
      apiKey,
      model,
      timeoutMs,
      extraBody: parseExtraBody(env.MODEL_EXTRA_BODY),
      maxTokens: env.MODEL_MAX_TOKENS ? Number(env.MODEL_MAX_TOKENS) : undefined,
      maxPerMinute: env.MODEL_MAX_PER_MINUTE ? Number(env.MODEL_MAX_PER_MINUTE) : undefined,
      fetch: doFetch,
    });
  }

  throw new Error(`MODEL_PROVIDER desconhecido: ${provider} (use "ollama" ou "openai")`);
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
