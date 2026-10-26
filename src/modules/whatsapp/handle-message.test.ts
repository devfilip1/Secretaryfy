import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { SendOutcome } from "../antiban/gate.js";
import { fixedTexts } from "../antiban/texts.js";
import type { RagAnswer } from "../rag/client.js";
import type { IncomingMessage } from "./evolution.js";
import { createMessageHandler, createRagReplier, splitReply, UNAVAILABLE_MESSAGE, type Replier } from "./handle-message.js";

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

test("resposta do folheto sai em até três mensagens, uma por parágrafo", async () => {
  const answer = "Yes, we do!\n\nIt takes 30–50 minutes.\n\nIt costs $40–$85.\n\nAnything else?";
  const f = fakes({ ask: async () => ({ ...ANSWER, answer }) });
  await f.handle(MESSAGE);
  assert.deepEqual(
    f.sent.map((x) => x.text),
    ["Yes, we do!", "It takes 30–50 minutes.", "It costs $40–$85.\nAnything else?"],
  );
});

test("se uma parte não sai, as seguintes também não", async () => {
  const f = fakes({ ask: async () => ({ ...ANSWER, answer: "One.\n\nTwo." }), outcome: "blocked" });
  await f.handle(MESSAGE);
  assert.deepEqual(f.sent.map((x) => x.text), ["One."]);
});

test("respostas do agendamento não são divididas", async () => {
  const f = fakes({ reply: async () => ({ text: "Available times:\n\n1. 9:00 AM\n\n2. 10:00 AM" }) });
  await f.handle(MESSAGE);
  assert.equal(f.sent.length, 1);
});

test("splitReply: sem parágrafos, uma mensagem só", () => {
  assert.deepEqual(splitReply("Braces cost $180–$450."), ["Braces cost $180–$450."]);
  assert.deepEqual(splitReply("  A.\n \n\nB.  "), ["A.", "B."]);
});

test("splitReply: bloco único e longo é separado pelas frases, em até três mensagens", () => {
  const block =
    "Yes, we do! Our Dental Cleaning removes plaque and tartar using ultrasound, followed by polishing. " +
    "It takes 30–50 minutes and costs $40–$85. You'll get an immediate feeling of a clean mouth, fresher breath, and prevention of more serious problems.";
  const parts = splitReply(block);
  assert.ok(parts.length >= 2 && parts.length <= 3, String(parts.length));
  assert.equal(parts.join(" "), block);
  assert.ok(parts.every((p) => /[.!?]$/.test(p)));
});

test("parte que o cliente acabou de receber é pulada e o resto da resposta sai", async () => {
  const f = fakes({ ask: async () => ({ ...ANSWER, answer: "Hi!\n\nYes, this is DentalSafe." }), recent: ["Hi!"] });
  await f.handle(MESSAGE);
  assert.deepEqual(f.sent.map((x) => x.text), ["Yes, this is DentalSafe."]);
});

test("followUp sai por último e conta no limite de três mensagens", async () => {
  const answer = "Yes, we do!\n\nIt takes 30–50 minutes.\n\nIt costs $40–$85.";
  const f = fakes({ reply: async () => ({ text: answer, split: true, followUp: "By the way, may I have your name?" }) });
  await f.handle(MESSAGE);
  assert.deepEqual(f.sent.map((x) => x.text), [
    "Yes, we do!",
    "It takes 30–50 minutes.\nIt costs $40–$85.",
    "By the way, may I have your name?",
  ]);
});

test("se a resposta não sai, o followUp também não", async () => {
  const f = fakes({ reply: async () => ({ text: "Hi!", split: true, followUp: "May I have your name?" }), outcome: "blocked" });
  await f.handle(MESSAGE);
  assert.deepEqual(f.sent.map((x) => x.text), ["Hi!"]);
});

test("splitReply respeita o limite de partes pedido", () => {
  assert.equal(splitReply("A.\n\nB.\n\nC.", 2).length, 2);
  const block = "One sentence here is long enough to count. ".repeat(12).trim();
  assert.ok(splitReply(block, 2).length <= 2);
});
