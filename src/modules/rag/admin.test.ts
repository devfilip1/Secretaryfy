import assert from "node:assert/strict";
import { test } from "node:test";
import { RagUnavailableError } from "./client.js";
import { createRagAdmin, RagAlreadyIndexingError } from "./admin.js";

const URL_BASE = "http://rag.test:8001";
const TOKEN = "t".repeat(32);

interface Call {
  url: string;
  init: RequestInit;
}

/** fetch falso: registra as chamadas e responde com o que `respond` devolver. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const healthBody = (state: string, builtFrom: string | null, status = "ready") => ({
  status,
  experiment: "b2",
  ollama: { reachable: true, url: "http://127.0.0.1:11434" },
  index: { strategy: "lex", state, reason: "", built_from: builtFrom },
  knowledge: { source: "http", version: "source-version" },
});

test("status reads index.state and index.built_from from GET /health", async () => {
  const { fetch, calls } = fakeFetch(() => json(healthBody("current", "v1")));
  const rag = createRagAdmin({ url: URL_BASE, token: TOKEN, fetch });
  assert.deepEqual(await rag.status(), { state: "current", indexedVersion: "v1" });
  assert.equal(calls[0].url, `${URL_BASE}/health`);
});

test("status reads the same fields from a 503 answer (up, but not ready)", async () => {
  const { fetch } = fakeFetch(() => json(healthBody("stale", null, "unavailable"), 503));
  const rag = createRagAdmin({ url: URL_BASE, token: TOKEN, fetch });
  assert.deepEqual(await rag.status(), { state: "stale", indexedVersion: null });
});

test("status gives the version the index was built from even when it is stale", async () => {
  // o índice defasado ainda responde com a versão antiga; é com ela que o painel compara
  const { fetch } = fakeFetch(() => json(healthBody("stale", "v9"), 200));
  const rag = createRagAdmin({ url: URL_BASE, token: TOKEN, fetch });
  assert.deepEqual(await rag.status(), { state: "stale", indexedVersion: "v9" });
});

test("status throws RagUnavailableError when the network fails", async () => {
  const { fetch } = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const rag = createRagAdmin({ url: URL_BASE, token: TOKEN, fetch });
  await assert.rejects(rag.status(), RagUnavailableError);
});

test("status throws RagUnavailableError when the answer is not the health payload", async () => {
  const { fetch } = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
  const rag = createRagAdmin({ url: URL_BASE, token: TOKEN, fetch });
  await assert.rejects(rag.status(), RagUnavailableError);
});

test("reindex posts with the bearer token and returns chunks and version", async () => {
  const { fetch, calls } = fakeFetch(() => json({ chunks: { lex: 30 }, version: "v2" }));
  const rag = createRagAdmin({ url: URL_BASE, token: TOKEN, fetch });
  assert.deepEqual(await rag.reindex(), { chunks: { lex: 30 }, version: "v2" });
  assert.equal(calls[0].url, `${URL_BASE}/reindex`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
});

test("reindex maps 409 to RagAlreadyIndexingError", async () => {
  const { fetch } = fakeFetch(() => json({ detail: "a reindex is already running" }, 409));
  const rag = createRagAdmin({ url: URL_BASE, token: TOKEN, fetch });
  await assert.rejects(rag.reindex(), (err: unknown) => err instanceof RagAlreadyIndexingError && err.message === "already indexing");
});

test("reindex maps a network failure and a 503 to RagUnavailableError", async () => {
  const down = createRagAdmin({
    url: URL_BASE,
    token: TOKEN,
    fetch: fakeFetch(() => {
      throw new TypeError("fetch failed");
    }).fetch,
  });
  await assert.rejects(down.reindex(), RagUnavailableError);

  const broken = createRagAdmin({ url: URL_BASE, token: TOKEN, fetch: fakeFetch(() => json({ detail: "x" }, 503)).fetch });
  await assert.rejects(broken.reindex(), RagUnavailableError);
});
