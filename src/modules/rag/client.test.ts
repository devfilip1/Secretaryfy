import assert from "node:assert/strict";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createRagClient, RagUnavailableError } from "./client.js";

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** Sobe um serviço RAG falso numa porta livre e devolve a URL. */
async function fakeService(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function json(status: number, body: unknown): RequestListener {
  return (_req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
}

const ANSWER = {
  answer: "Braces cost $180–$450 (Initial cost) and $35–$90 (Monthly).",
  chunks: [{ rank: 1, content: "Braces", score: 0.03, similarity: 0.71 }],
  latency_s: 0.74,
  experiment: "section_hybrid",
};

test("envia a pergunta para /answer e devolve a resposta", async () => {
  let received: { url?: string; body?: string } = {};
  const baseUrl = await fakeService((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received = { url: req.url, body };
      json(200, ANSWER)(req, res);
    });
  });

  const result = await createRagClient({ baseUrl, timeoutMs: 1000 }).ask("How much are braces?");

  assert.deepEqual(result, ANSWER);
  assert.equal(received.url, "/answer");
  assert.deepEqual(JSON.parse(received.body!), { question: "How much are braces?" });
});

test("status de erro vira RagUnavailableError", async () => {
  const baseUrl = await fakeService(json(503, { detail: "Ollama is not running" }));
  await assert.rejects(
    createRagClient({ baseUrl, timeoutMs: 1000 }).ask("x"),
    (err) => err instanceof RagUnavailableError && /503/.test(err.message),
  );
});

test("resposta sem answer vira RagUnavailableError", async () => {
  const baseUrl = await fakeService(json(200, { chunks: [] }));
  await assert.rejects(createRagClient({ baseUrl, timeoutMs: 1000 }).ask("x"), RagUnavailableError);
});

test("passar do tempo limite vira RagUnavailableError", async () => {
  const baseUrl = await fakeService((req, res) => {
    setTimeout(() => json(200, ANSWER)(req, res), 500);
  });
  await assert.rejects(createRagClient({ baseUrl, timeoutMs: 50 }).ask("x"), RagUnavailableError);
});

test("serviço fora do ar vira RagUnavailableError", async () => {
  const baseUrl = await fakeService(json(200, ANSWER));
  servers.pop()!.close();
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(createRagClient({ baseUrl, timeoutMs: 1000 }).ask("x"), RagUnavailableError);
});
