import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { MessageRow } from "../../db/schema.js";
import type { SendResult } from "../inbox/service.js";
import type { RagAnswer } from "../rag/client.js";
import type { IncomingMessage } from "./evolution.js";
import { createMessageHandler, createRagReplier, UNAVAILABLE_MESSAGE, type Replier } from "./handle-message.js";

const MESSAGE: IncomingMessage = {
  kind: "message",
  id: "MSG1",
  phone: "5511999999999",
  fromMe: false,
  type: "text",
  text: "How much are braces?",
  sentAt: new Date(),
};
const ANSWER: RagAnswer = { answer: "Braces cost $180–$450.", chunks: [], latency_s: 0.7, experiment: "section_hybrid" };

function fakes(
  options: { ask?: () => Promise<RagAnswer>; send?: () => Promise<{ waId: string }>; paused?: boolean[]; reply?: Replier } = {},
) {
  const asked: string[] = [];
  const sent: [string, string][] = [];
  const started: string[] = [];
  const finished: SendResult[] = [];
  const errors: unknown[] = [];
  const infos: string[] = [];
  const paused = [...(options.paused ?? [])];
  const log = {
    info: (_obj: unknown, msg: string) => infos.push(msg),
    error: (obj: unknown) => errors.push(obj),
  } as unknown as FastifyBaseLogger;

  const handle = createMessageHandler({
    reply:
      options.reply ??
      createRagReplier(async (q) => {
        asked.push(q);
        return options.ask ? options.ask() : ANSWER;
      }),
    send: async (phone, text) => {
      sent.push([phone, text]);
      return options.send ? options.send() : { waId: "OUT1" };
    },
    inbox: {
      isPaused: async () => paused.shift() ?? false,
      startOutgoing: async ({ text }) => {
        started.push(text);
        return { id: "m-out" } as MessageRow;
      },
      finishOutgoing: async (_id, result) => {
        finished.push(result);
      },
    },
  });
  return {
    handle: (m: IncomingMessage) => handle({ conversationId: "c1", message: m }, log),
    asked,
    sent,
    started,
    finished,
    errors,
    infos,
  };
}

test("pergunta ao assistente, registra e envia a resposta", async () => {
  const f = fakes();
  await f.handle(MESSAGE);
  assert.deepEqual(f.asked, ["How much are braces?"]);
  assert.deepEqual(f.started, [ANSWER.answer]);
  assert.deepEqual(f.sent, [["5511999999999", ANSWER.answer]]);
  assert.deepEqual(f.finished, [{ waId: "OUT1" }]);
});

test("com o assistente indisponível envia e registra a mensagem de indisponibilidade", async () => {
  const f = fakes({ ask: () => Promise.reject(new Error("down")) });
  await f.handle(MESSAGE);
  assert.deepEqual(f.sent, [["5511999999999", UNAVAILABLE_MESSAGE]]);
  assert.equal(f.errors.length, 1);
  assert.equal((f.errors[0] as { phone: string }).phone, "5511999999999");
});

test("falha ao enviar fica registrada como failed e não rejeita", async () => {
  const f = fakes({ send: () => Promise.reject(new Error("evolution down")) });
  await f.handle(MESSAGE);
  assert.deepEqual(f.finished, [{ error: "evolution down" }]);
  assert.equal(f.errors.length, 1);
});

test("conversa pausada: não pergunta ao assistente", async () => {
  const f = fakes({ paused: [true] });
  await f.handle(MESSAGE);
  assert.deepEqual(f.asked, []);
  assert.deepEqual(f.sent, []);
});

test("pausada enquanto o assistente respondia: a resposta é descartada", async () => {
  const f = fakes({ paused: [false, true] });
  await f.handle(MESSAGE);
  assert.equal(f.asked.length, 1);
  assert.deepEqual(f.started, []);
  assert.deepEqual(f.sent, []);
  assert.ok(f.infos.includes("resposta descartada: conversa pausada"));
});

test("mídia não é enviada ao assistente", async () => {
  const f = fakes();
  await f.handle({ ...MESSAGE, type: "audio", text: null });
  assert.deepEqual(f.asked, []);
});

test("resposta de handoff é enviada mesmo com a conversa recém-pausada (specs/003 FR-024a)", async () => {
  const f = fakes({ paused: [false, true], reply: async () => ({ text: "Someone from our team will continue.", ignorePause: true }) });
  await f.handle(MESSAGE);
  assert.deepEqual(f.sent, [["5511999999999", "Someone from our team will continue."]]);
});

test("sem resposta (null), nada é enviado", async () => {
  const f = fakes({ reply: async () => null });
  await f.handle(MESSAGE);
  assert.deepEqual(f.started, []);
  assert.deepEqual(f.sent, []);
});
