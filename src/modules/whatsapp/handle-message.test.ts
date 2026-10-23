import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { SendOutcome } from "../antiban/gate.js";
import { fixedTexts } from "../antiban/texts.js";
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
  options: {
    ask?: () => Promise<RagAnswer>;
    outcome?: SendOutcome;
    paused?: boolean[];
    reply?: Replier;
    optedOut?: boolean;
    recent?: string[];
    scheduling?: boolean;
  } = {},
) {
  const asked: string[] = [];
  const sent: { phone: string; text: string; ignorePause?: boolean; bypass?: string[] }[] = [];
  const optOuts: [boolean, string][] = [];
  const errors: unknown[] = [];
  const infos: string[] = [];
  const paused = [...(options.paused ?? [])];
  let optedOut = options.optedOut ?? false;
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
    gate: {
      sendAssistant: async ({ phone, text, ignorePause, bypass }) => {
        sent.push({ phone, text, ignorePause, bypass });
        return options.outcome ?? "sent";
      },
      pickVariant: async (_id, variants) => variants.find((v) => !(options.recent ?? []).includes(v)) ?? null,
    },
    inbox: {
      isPaused: async () => paused.shift() ?? false,
      isOptedOut: async () => optedOut,
      setOptedOut: async (_id, value, note) => {
        optedOut = value;
        optOuts.push([value, note]);
      },
    },
    hasSchedulingSession: async () => options.scheduling ?? false,
  });
  return {
    handle: (m: IncomingMessage) => handle({ conversationId: "c1", message: m }, log),
    asked,
    sent,
    texts: () => sent.map((x) => [x.phone, x.text]),
    optOuts,
    errors,
    infos,
  };
}

test("pergunta ao assistente e entrega a resposta ao portão", async () => {
  const f = fakes();
  await f.handle(MESSAGE);
  assert.deepEqual(f.asked, ["How much are braces?"]);
  assert.deepEqual(f.texts(), [["5511999999999", ANSWER.answer]]);
});

test("com o assistente indisponível envia uma variação da indisponibilidade", async () => {
  const f = fakes({ ask: () => Promise.reject(new Error("down")) });
  await f.handle(MESSAGE);
  assert.deepEqual(f.texts(), [["5511999999999", UNAVAILABLE_MESSAGE]]);
  assert.equal(f.errors.length, 1);
  assert.equal((f.errors[0] as { phone: string }).phone, "5511999999999");
});

test("indisponibilidade já enviada: sai a próxima variação; todas enviadas, nada sai (specs/004 FR-017)", async () => {
  const down = () => Promise.reject(new Error("down"));
  const f = fakes({ ask: down, recent: [fixedTexts.unavailable[0]] });
  await f.handle(MESSAGE);
  assert.deepEqual(f.texts(), [["5511999999999", fixedTexts.unavailable[1]]]);
  const g = fakes({ ask: down, recent: fixedTexts.unavailable });
  await g.handle(MESSAGE);
  assert.deepEqual(g.sent, []);
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
  assert.deepEqual(f.texts(), [["5511999999999", "Someone from our team will continue."]]);
  assert.equal(f.sent[0].ignorePause, true);
});

test("sem resposta (null), nada é enviado", async () => {
  const f = fakes({ reply: async () => null });
  await f.handle(MESSAGE);
  assert.deepEqual(f.sent, []);
});

// --- Pedido de saída (specs/004 US3) ---

test("STOP: registra a saída e manda uma única confirmação, sem perguntar ao assistente", async () => {
  const f = fakes();
  await f.handle({ ...MESSAGE, text: "STOP" });
  assert.deepEqual(f.asked, []);
  assert.equal(f.optOuts.length, 1);
  assert.equal(f.optOuts[0][0], true);
  assert.deepEqual(f.texts(), [["5511999999999", fixedTexts.optOutConfirmation[0]]]);
  assert.deepEqual(f.sent[0].bypass, ["opted_out", "unanswered"]);
});

test("quem saiu não recebe resposta, e um segundo STOP não manda outra confirmação", async () => {
  const f = fakes({ optedOut: true });
  await f.handle(MESSAGE);
  await f.handle({ ...MESSAGE, text: "parar" });
  assert.deepEqual(f.asked, []);
  assert.deepEqual(f.sent, []);
});

test("START volta a aceitar mensagens e dá as boas-vindas", async () => {
  const f = fakes({ optedOut: true });
  await f.handle({ ...MESSAGE, text: "Start" });
  assert.deepEqual(f.optOuts.map((o) => o[0]), [false]);
  assert.deepEqual(f.texts(), [["5511999999999", fixedTexts.optIn[0]]]);
});

test("'cancelar' com agendamento em andamento segue para o agendamento", async () => {
  const f = fakes({ scheduling: true });
  await f.handle({ ...MESSAGE, text: "cancelar" });
  assert.deepEqual(f.optOuts, []);
  assert.deepEqual(f.asked, ["cancelar"]);
});
