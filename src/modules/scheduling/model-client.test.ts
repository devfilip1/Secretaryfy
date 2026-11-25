import assert from "node:assert/strict";
import { test } from "node:test";
import { InterpreterUnavailable } from "./ollama.js";
import { assertProviderAllowed, createModelClientFromEnv, createOpenAICompatClient, resolveOpenAICompatibleConfig } from "./model-client.js";

const KEY = "sk-teste-nao-real-123";
const FORMAT = { type: "object", properties: { intent: { type: "string" } }, required: ["intent"] };
const MESSAGES = [{ role: "user" as const, content: "oi" }];

type Call = { url: string; init: RequestInit };

/** Fetch falso: responde os itens da fila em ordem (Error é lançado) e guarda as chamadas. */
function fakeFetch(queue: (Response | Error)[]) {
  const calls: Call[] = [];
  const doFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const item = queue.shift();
    if (item instanceof Error) throw item;
    return item ?? new Response("sem resposta", { status: 500 });
  }) as typeof globalThis.fetch;
  return { fetch: doFetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: headers });

const content = (text: string | null) => json({ choices: [{ message: { content: text } }] });

function clientWithQueue(
  queue: (Response | Error)[],
  extra: { extraBody?: Record<string, unknown>; maxTokens?: number; maxPerMinute?: number; now?: () => number; jitter?: () => number } = {},
) {
  const fake = fakeFetch(queue);
  const waits: number[] = [];
  const client = createOpenAICompatClient({
    baseUrl: "https://modelo.test/v1/",
    apiKey: KEY,
    model: "modelo-x",
    timeoutMs: 1000,
    fetch: fake.fetch,
    jitter: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
    },
    ...extra,
  });
  return { client, calls: fake.calls, waits };
}

test("envia URL sem barra final, cabeçalhos e corpo com json_schema", async () => {
  const { client, calls } = clientWithQueue([content('{"intent":"x"}')]);
  await client.chat({ messages: MESSAGES, format: FORMAT });

  const [call] = calls;
  assert.equal(call.url, "https://modelo.test/v1/chat/completions");
  assert.equal(call.init.method, "POST");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(String(call.init.body)), {
    model: "modelo-x",
    messages: MESSAGES,
    temperature: 0,
    max_tokens: 1024,
    response_format: { type: "json_schema", json_schema: { name: "reply", schema: FORMAT, strict: true } },
  });
});

test("extraBody e maxTokens entram no corpo e extraBody sobrescreve os padrões", async () => {
  const { client, calls } = clientWithQueue([content('{"intent":"x"}')], {
    maxTokens: 256,
    extraBody: { temperature: 0.7, chat_template_kwargs: { enable_thinking: false } },
  });
  await client.chat({ messages: MESSAGES, format: FORMAT });

  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.max_tokens, 256);
  assert.equal(body.temperature, 0.7);
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
});

test("conteúdo JSON é devolvido já convertido", async () => {
  const { client } = clientWithQueue([content('{"intent":"agendar"}')]);
  assert.deepEqual(await client.chat({ messages: MESSAGES, format: FORMAT }), { intent: "agendar" });
});

test("conteúdo que não é JSON vira null", async () => {
  const { client } = clientWithQueue([content("não sei responder")]);
  assert.equal(await client.chat({ messages: MESSAGES, format: FORMAT }), null);
});

test("conteúdo null ou vazio vira null (modelo de raciocínio sem resposta)", async () => {
  const { client } = clientWithQueue([content(null), content("   ")]);
  assert.equal(await client.chat({ messages: MESSAGES, format: FORMAT }), null);
  assert.equal(await client.chat({ messages: MESSAGES, format: FORMAT }), null);
});

test("429 seguido de sucesso espera o retry-after e tenta de novo", async () => {
  const { client, calls, waits } = clientWithQueue([
    json({}, 429, { "retry-after": "5" }),
    content('{"intent":"ok"}'),
  ]);
  assert.deepEqual(await client.chat({ messages: MESSAGES, format: FORMAT }), { intent: "ok" });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [5000]);
});

test("retry-after acima de 30 s é limitado a 30 s", async () => {
  const { client, waits } = clientWithQueue([json({}, 429, { "retry-after": "120" }), content('{"intent":"ok"}')]);
  await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.deepEqual(waits, [30000]);
});

test("retry-after menor que o recuo não vence; maior vence", async () => {
  const { client, waits } = clientWithQueue([
    json({}, 429, { "retry-after": "1" }),
    json({}, 429),
    json({}, 429, { "retry-after": "10" }),
    json({}, 429),
    content('{"intent":"ok"}'),
  ]);
  assert.deepEqual(await client.chat({ messages: MESSAGES, format: FORMAT }), { intent: "ok" });
  // 1 s < recuo de 2 s; 10 s > recuo de 8 s; sem cabeçalho, recuo de 4 s e 16 s
  assert.deepEqual(waits, [2000, 4000, 10000, 16000]);
});

test("jitter soma até 25 % ao recuo, e o teto de 30 s vale depois do jitter", async () => {
  const { client, waits } = clientWithQueue([json({}, 429), json({}, 429, { "retry-after": "30" }), content('{"intent":"ok"}')], {
    jitter: () => 0.25,
  });
  await client.chat({ messages: MESSAGES, format: FORMAT });
  // 2 s + 25 % = 2500 ms; 30 s + 25 % passaria do teto, então fica em 30 s
  assert.deepEqual(waits, [2500, 30000]);
});

test("429 cinco vezes seguidas lança InterpreterUnavailable após 5 chamadas, com recuo exponencial", async () => {
  const { client, calls, waits } = clientWithQueue([json({}, 429), json({}, 429), json({}, 429), json({}, 429), json({}, 429)]);
  await assert.rejects(client.chat({ messages: MESSAGES, format: FORMAT }), (err: Error) => {
    assert.ok(err instanceof InterpreterUnavailable);
    assert.match(err.message, /limite de requisições/);
    assert.match(err.message, /5 tentativas/);
    return true;
  });
  assert.equal(calls.length, 5);
  assert.deepEqual(waits, [2000, 4000, 8000, 16000]);
  assert.deepEqual(client.stats?.(), { calls: 1, rateLimited: 5, failed: 1 });
});

test("erro 500 lança InterpreterUnavailable sem vazar a chave", async () => {
  const { client } = clientWithQueue([new Response(`erro interno, chave ${KEY} recusada`, { status: 500 })]);
  await assert.rejects(client.chat({ messages: MESSAGES, format: FORMAT }), (err: Error) => {
    assert.ok(err instanceof InterpreterUnavailable);
    assert.match(err.message, /500/);
    assert.doesNotMatch(err.message, /sk-teste-nao-real/);
    return true;
  });
});

test("falha de rede lança InterpreterUnavailable", async () => {
  const { client } = clientWithQueue([new TypeError("fetch failed")]);
  await assert.rejects(client.chat({ messages: MESSAGES, format: FORMAT }), InterpreterUnavailable);
});

test("timeout lança InterpreterUnavailable", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const { client } = clientWithQueue([timeout]);
  await assert.rejects(client.chat({ messages: MESSAGES, format: FORMAT }), InterpreterUnavailable);
});

test("stats conta 429 repetidos mesmo quando a chamada depois dá certo", async () => {
  const { client, waits } = clientWithQueue([json({}, 429), json({}, 429), content('{"intent":"ok"}')]);
  await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.deepEqual(client.stats?.(), { calls: 1, rateLimited: 2, failed: 0 });
  assert.deepEqual(waits, [2000, 4000]);
});

test("stats conta falha depois de esgotar as tentativas de 429", async () => {
  const { client } = clientWithQueue([json({}, 429), json({}, 429), json({}, 429), json({}, 429), json({}, 429)]);
  await assert.rejects(client.chat({ messages: MESSAGES, format: FORMAT }), InterpreterUnavailable);
  assert.deepEqual(client.stats?.(), { calls: 1, rateLimited: 5, failed: 1 });
});

test("stats conta todas as chamadas, inclusive as que deram certo", async () => {
  const { client } = clientWithQueue([content('{"intent":"a"}'), content('{"intent":"b"}'), content(null)]);
  await client.chat({ messages: MESSAGES, format: FORMAT });
  await client.chat({ messages: MESSAGES, format: FORMAT });
  await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.deepEqual(client.stats?.(), { calls: 3, rateLimited: 0, failed: 0 });
});

test("stats conta a falha mesmo quando quem chama engole o erro", async () => {
  const { client } = clientWithQueue([new TypeError("fetch failed")]);
  const result = await client.chat({ messages: MESSAGES, format: FORMAT }).catch(() => "engolido");
  assert.equal(result, "engolido");
  assert.deepEqual(client.stats?.(), { calls: 1, rateLimited: 0, failed: 1 });
});

test("stats conta erro HTTP 500 como falha, sem contar 429", async () => {
  const { client } = clientWithQueue([new Response("erro", { status: 500 })]);
  await assert.rejects(client.chat({ messages: MESSAGES, format: FORMAT }), InterpreterUnavailable);
  assert.deepEqual(client.stats?.(), { calls: 1, rateLimited: 0, failed: 1 });
});

/** Cliente com limite por minuto; sleep avança o relógio injetado, como o tempo real faria. */
function limitedClient(responses: Response[], maxPerMinute: number, clock: { now: number }, waits: number[], burst?: number) {
  const fake = fakeFetch(responses);
  const client = createOpenAICompatClient({
    baseUrl: "https://modelo.test/v1",
    apiKey: KEY,
    model: "modelo-x",
    timeoutMs: 1000,
    maxPerMinute,
    burst,
    fetch: fake.fetch,
    jitter: () => 0,
    now: () => clock.now,
    sleep: async (ms) => {
      waits.push(ms);
      clock.now += ms;
    },
  });
  return { client, calls: fake.calls };
}

test("maxPerMinute: as 4 primeiras chamadas seguidas (rajada) não esperam", async () => {
  const waits: number[] = [];
  const responses = Array.from({ length: 4 }, (_, i) => content('{"intent":"' + i + '"}'));
  const { client, calls } = limitedClient(responses, 35, { now: 0 }, waits);
  for (let i = 0; i < 4; i++) await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, []);
});

test("maxPerMinute: a 5ª chamada seguida espera 60000/N ms, arredondados para cima", async () => {
  const waits: number[] = [];
  const responses = Array.from({ length: 5 }, () => content('{"intent":"a"}'));
  const { client } = limitedClient(responses, 35, { now: 0 }, waits);
  for (let i = 0; i < 5; i++) await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.deepEqual(waits, [Math.ceil(60000 / 35)]);
});

test("maxPerMinute: uma rajada de 2 chamadas com limite 35 não espera", async () => {
  const waits: number[] = [];
  const { client, calls } = limitedClient([content('{"intent":"a"}'), content('{"intent":"b"}')], 35, { now: 0 }, waits, 2);
  await client.chat({ messages: MESSAGES, format: FORMAT });
  await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, []);
});

test("maxPerMinute: a ficha gasta volta depois de 60000/N ms", async () => {
  const clock = { now: 0 };
  const waits: number[] = [];
  const { client } = limitedClient([content('{"intent":"a"}'), content('{"intent":"b"}')], 35, clock, waits, 1);
  await client.chat({ messages: MESSAGES, format: FORMAT });
  clock.now = Math.ceil(60000 / 35);
  await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.deepEqual(waits, []);
});

test("maxPerMinute: a reposição nunca passa da capacidade do balde", async () => {
  const clock = { now: 0 };
  const waits: number[] = [];
  const responses = Array.from({ length: 5 }, () => content('{"intent":"a"}'));
  const { client } = limitedClient(responses, 35, clock, waits, 2);
  await client.chat({ messages: MESSAGES, format: FORMAT });
  await client.chat({ messages: MESSAGES, format: FORMAT });
  clock.now = 600000;
  await client.chat({ messages: MESSAGES, format: FORMAT });
  await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.deepEqual(waits, []);
  await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.deepEqual(waits, [Math.ceil(60000 / 35)]);
});

test("maxPerMinute: chamadas simultâneas com o balde vazio entram na fila, cada uma no seu horário", async () => {
  const waits: number[] = [];
  const fake = fakeFetch([content('{"intent":"a"}'), content('{"intent":"b"}'), content('{"intent":"c"}')]);
  const client = createOpenAICompatClient({
    baseUrl: "https://modelo.test/v1",
    apiKey: KEY,
    model: "modelo-x",
    timeoutMs: 1000,
    maxPerMinute: 1,
    burst: 1,
    fetch: fake.fetch,
    now: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  await Promise.all([
    client.chat({ messages: MESSAGES, format: FORMAT }),
    client.chat({ messages: MESSAGES, format: FORMAT }),
    client.chat({ messages: MESSAGES, format: FORMAT }),
  ]);
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(waits, [60000, 120000]);
});

test("maxPerMinute: o retry após 429 também passa pelo limitador", async () => {
  const waits: number[] = [];
  const { client } = limitedClient([json({}, 429, { "retry-after": "0.5" }), content('{"intent":"ok"}')], 1, { now: 0 }, waits, 1);
  assert.deepEqual(await client.chat({ messages: MESSAGES, format: FORMAT }), { intent: "ok" });
  // 2 s de recuo (maior que os 500 ms do retry-after); depois o balde (1 ficha por minuto, já gasta) segura o retry até a ficha voltar: 58000 ms
  assert.deepEqual(waits, [2000, 58000]);
});

test("sem maxPerMinute não espera nada entre chamadas", async () => {
  const { client, waits } = clientWithQueue([content('{"intent":"a"}'), content('{"intent":"b"}'), content('{"intent":"c"}')]);
  await client.chat({ messages: MESSAGES, format: FORMAT });
  await client.chat({ messages: MESSAGES, format: FORMAT });
  await client.chat({ messages: MESSAGES, format: FORMAT });
  assert.deepEqual(waits, []);
});

test("fábrica sem MODEL_PROVIDER usa Ollama local com qwen3:8b", async () => {
  const fake = fakeFetch([json({ message: { content: '{"intent":"x"}' } })]);
  const client = createModelClientFromEnv({}, { fetch: fake.fetch });
  assert.equal(client.model, "qwen3:8b");
  assert.deepEqual(await client.chat({ messages: MESSAGES, format: FORMAT }), { intent: "x" });
  assert.equal(fake.calls[0].url, "http://127.0.0.1:11434/api/chat");
});

test("fábrica Ollama conta chamadas, 429 e falhas sem mudar o erro", async () => {
  const fake = fakeFetch([new Response("muitas requisições", { status: 429 })]);
  const client = createModelClientFromEnv({}, { fetch: fake.fetch });
  await assert.rejects(client.chat({ messages: MESSAGES, format: FORMAT }), InterpreterUnavailable);
  assert.deepEqual(client.stats?.(), { calls: 1, rateLimited: 1, failed: 1 });
});

test("fábrica Ollama aceita AGENT_MODEL como nome do modelo", () => {
  const client = createModelClientFromEnv({ MODEL_PROVIDER: "ollama", AGENT_MODEL: "llama3" }, { fetch: fakeFetch([]).fetch });
  assert.equal(client.model, "llama3");
});

test("fábrica openai-compatible com todas as variáveis monta o cliente com extraBody e maxTokens", async () => {
  const fake = fakeFetch([content('{"intent":"ok"}')]);
  const client = createModelClientFromEnv(
    {
      MODEL_PROVIDER: "openai-compatible",
      MODEL_BASE_URL: "https://modelo.test/v1",
      MODEL_API_KEY: KEY,
      MODEL_NAME: "modelo-x",
      MODEL_EXTRA_BODY: '{"chat_template_kwargs":{"enable_thinking":false}}',
      MODEL_MAX_TOKENS: "300",
    },
    { fetch: fake.fetch },
  );
  assert.equal(client.model, "modelo-x");
  assert.deepEqual(await client.chat({ messages: MESSAGES, format: FORMAT }), { intent: "ok" });

  assert.equal(fake.calls[0].url, "https://modelo.test/v1/chat/completions");
  const body = JSON.parse(String(fake.calls[0].init.body));
  assert.equal(body.max_tokens, 300);
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
});

test("fábrica openai-compatible sem variáveis lança erro que nomeia só as variáveis faltando", () => {
  assert.throws(
    () => createModelClientFromEnv({ MODEL_PROVIDER: "openai-compatible", MODEL_API_KEY: KEY }),
    (err: Error) => {
      assert.match(err.message, /MODEL_BASE_URL/);
      assert.match(err.message, /MODEL_NAME/);
      assert.doesNotMatch(err.message, /MODEL_API_KEY/);
      assert.doesNotMatch(err.message, /sk-teste-nao-real/);
      return true;
    },
  );
});

test("fábrica openai-compatible recusa MODEL_EXTRA_BODY que não é JSON", () => {
  const env = { MODEL_PROVIDER: "openai-compatible", MODEL_BASE_URL: "https://m.test", MODEL_API_KEY: KEY, MODEL_NAME: "m", MODEL_EXTRA_BODY: "{nao e json" };
  assert.throws(() => createModelClientFromEnv(env), /MODEL_EXTRA_BODY não é JSON válido/);
});

test("fábrica openai-compatible recusa MODEL_EXTRA_BODY que não é objeto", () => {
  const env = { MODEL_PROVIDER: "openai-compatible", MODEL_BASE_URL: "https://m.test", MODEL_API_KEY: KEY, MODEL_NAME: "m", MODEL_EXTRA_BODY: "[1,2]" };
  assert.throws(() => createModelClientFromEnv(env), /precisa ser um objeto JSON/);
});

test("fábrica nvidia chama o endpoint do preset com o extraBody padrão", async () => {
  const fake = fakeFetch([content('{"intent":"ok"}')]);
  const client = createModelClientFromEnv({ MODEL_PROVIDER: "nvidia", MODEL_API_KEY: KEY }, { fetch: fake.fetch });
  assert.equal(client.model, "nvidia/nemotron-3-ultra-550b-a55b");
  await client.chat({ messages: MESSAGES, format: FORMAT });

  assert.equal(fake.calls[0].url, "https://integrate.api.nvidia.com/v1/chat/completions");
  const body = JSON.parse(String(fake.calls[0].init.body));
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
});

test("nvidia sem MODEL_API_KEY lança erro que nomeia só MODEL_API_KEY", () => {
  assert.throws(
    () => createModelClientFromEnv({ MODEL_PROVIDER: "nvidia" }),
    (err: Error) => {
      assert.equal(err.message, "MODEL_PROVIDER=nvidia precisa das variáveis: MODEL_API_KEY");
      return true;
    },
  );
});

test("nvidia sem variáveis extras usa os padrões do preset", () => {
  assert.deepEqual(resolveOpenAICompatibleConfig({ MODEL_API_KEY: KEY }, "nvidia"), {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey: KEY,
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    timeoutMs: 60000,
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
    maxTokens: undefined,
    maxPerMinute: 35,
  });
});

test("cada variável do ambiente vence o preset nvidia, e MODEL_EXTRA_BODY substitui o extraBody inteiro", () => {
  const config = resolveOpenAICompatibleConfig(
    {
      MODEL_API_KEY: KEY,
      MODEL_BASE_URL: "https://outro.test/v1",
      MODEL_NAME: "outro-modelo",
      MODEL_EXTRA_BODY: '{"x":1}',
      MODEL_MAX_TOKENS: "300",
      MODEL_MAX_PER_MINUTE: "10",
      AGENT_TIMEOUT_MS: "5000",
    },
    "nvidia",
  );
  assert.deepEqual(config, {
    baseUrl: "https://outro.test/v1",
    apiKey: KEY,
    model: "outro-modelo",
    timeoutMs: 5000,
    extraBody: { x: 1 },
    maxTokens: 300,
    maxPerMinute: 10,
  });
});

test("AGENT_TIMEOUT_MS ausente: 60 s com nvidia e 20 s com openai-compatible", () => {
  const env = { MODEL_API_KEY: KEY, MODEL_BASE_URL: "https://m.test", MODEL_NAME: "m" };
  assert.equal(resolveOpenAICompatibleConfig(env, "nvidia").timeoutMs, 60000);
  assert.equal(resolveOpenAICompatibleConfig(env, "openai-compatible").timeoutMs, 20000);
});

test("openai-compatible não tem preset: sem extraBody nem limite por minuto", () => {
  const config = resolveOpenAICompatibleConfig({ MODEL_API_KEY: KEY, MODEL_BASE_URL: "https://m.test", MODEL_NAME: "m" }, "openai-compatible");
  assert.equal(config.extraBody, undefined);
  assert.equal(config.maxPerMinute, undefined);
});

test("fábrica recusa provedor desconhecido e lista os valores válidos, sem alias para o nome antigo", () => {
  for (const provider of ["outro", "openai"]) {
    assert.throws(
      () => createModelClientFromEnv({ MODEL_PROVIDER: provider }),
      (err: Error) => {
        assert.match(err.message, new RegExp(`MODEL_PROVIDER desconhecido: ${provider} `));
        assert.match(err.message, /"ollama", "openai-compatible", "nvidia"/);
        return true;
      },
    );
  }
});

test("assertProviderAllowed recusa nvidia só em produção", () => {
  assert.match(assertProviderAllowed("nvidia", "production") ?? "", /LGPD/);
  assert.equal(assertProviderAllowed("nvidia", "development"), undefined);
  assert.equal(assertProviderAllowed("nvidia", undefined), undefined);
  assert.equal(assertProviderAllowed("openai-compatible", "production"), undefined);
  assert.equal(assertProviderAllowed("ollama", "production"), undefined);
});
