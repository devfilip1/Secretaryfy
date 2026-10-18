import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { ConversationRow, SchedulingSessionRow } from "../../db/schema.js";
import type { IncomingMessage } from "../whatsapp/evolution.js";
import { UNAVAILABLE_MESSAGE } from "../whatsapp/handle-message.js";
import type { SchedulingFlow } from "./flow.js";
import type { Interpretation, InterpretInput, Interpreter } from "./interpret.js";
import { InterpreterUnavailable } from "./ollama.js";
import { createSchedulingRouter } from "./router.js";
import { DEFAULT_RULES } from "./rules.js";

const log = { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
const MESSAGE: IncomingMessage = {
  kind: "message",
  id: "M1",
  phone: "5571999999999",
  fromMe: false,
  type: "text",
  text: "How much are braces?",
  sentAt: new Date(),
};
const SESSION = { conversationId: "c1", step: "choose_day", options: [{ n: 1, kind: "day", date: "2026-10-21" }] } as SchedulingSessionRow;

function setup({ intent, session = null, unavailable = false }: { intent?: Interpretation["intent"]; session?: SchedulingSessionRow | null; unavailable?: boolean }) {
  const inputs: InterpretInput[] = [];
  const handled: Interpretation[] = [];
  const asked: string[] = [];
  const interpreter: Interpreter = {
    interpret: async (input) => {
      inputs.push(input);
      if (unavailable) throw new InterpreterUnavailable("Ollama fora do ar");
      return { intent: intent!, option: null, date: null, name: null, source: "model" };
    },
  };
  const flow = {
    handle: async ({ interpretation }: { interpretation: Interpretation }) => {
      handled.push(interpretation);
      return interpretation.intent === "unclear" ? { reply: "handoff", handoff: true } : { reply: "do agendamento" };
    },
  } as unknown as SchedulingFlow;

  const reply = createSchedulingRouter({
    interpreter,
    flow,
    store: { getSession: async () => session },
    inbox: {
      getConversation: async () => ({ id: "c1", phone: MESSAGE.phone, name: "Maria" }) as ConversationRow,
      recentHistory: async () => [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: MESSAGE.text! },
      ],
    },
    connection: { getForUse: async () => ({ refreshToken: "t", calendarId: "primary", timeZone: "America/Bahia", status: "connected" }) },
    rules: { get: async () => DEFAULT_RULES },
    answerQuestion: async (q) => {
      asked.push(q);
      return "do folheto";
    },
  });
  return { reply: () => reply({ conversationId: "c1", message: MESSAGE }, log), inputs, handled, asked };
}

test("sem etapa, dúvida vai para o folheto", async () => {
  const r = setup({ intent: "question" });
  assert.deepEqual(await r.reply(), { text: "do folheto" });
  assert.deepEqual(r.asked, ["How much are braces?"]);
  assert.equal(r.handled.length, 0);
});

test("sem etapa, intenção que não começa um fluxo também vai para o folheto", async () => {
  for (const intent of ["unclear", "yes", "choose"] as const) {
    const r = setup({ intent });
    assert.deepEqual(await r.reply(), { text: "do folheto" });
  }
});

test("sem etapa, pedido de agendamento vai para o fluxo", async () => {
  const r = setup({ intent: "book" });
  assert.deepEqual(await r.reply(), { text: "do agendamento", ignorePause: undefined });
  assert.equal(r.handled[0].intent, "book");
});

test("com etapa, dúvida vai para o folheto e a etapa continua; o resto vai para o fluxo", async () => {
  const q = setup({ intent: "question", session: SESSION });
  assert.deepEqual(await q.reply(), { text: "do folheto" });
  const c = setup({ intent: "unclear", session: SESSION });
  assert.deepEqual(await c.reply(), { text: "handoff", ignorePause: true });
});

test("o interpretador recebe a etapa, as opções e o histórico sem a mensagem atual", async () => {
  const r = setup({ intent: "book", session: SESSION });
  await r.reply();
  const input = r.inputs[0];
  assert.equal(input.step, "choose_day");
  assert.equal(input.options.length, 1);
  assert.equal(input.timeZone, "America/Bahia");
  assert.deepEqual(input.history.map((m) => m.content), ["hi", "Hello!"]);
  assert.equal(input.text, "How much are braces?");
});

test("Ollama fora do ar: sem etapa vai para o folheto; com etapa, indisponibilidade", async () => {
  assert.deepEqual(await setup({ unavailable: true }).reply(), { text: "do folheto" });
  assert.deepEqual(await setup({ unavailable: true, session: SESSION }).reply(), { text: UNAVAILABLE_MESSAGE });
});
