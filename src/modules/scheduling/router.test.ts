import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { AppointmentRow, ConversationRow, SchedulingSessionRow } from "../../db/schema.js";
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

function setup({
  intent,
  session = null,
  unavailable = false,
  customerName = "Maria",
  registryName = null,
  nameAskedAt = null,
  messagesSinceAsk = 1,
  name = null,
  reminded = null,
  messagesSinceReminder = 1,
}: {
  intent?: Interpretation["intent"];
  session?: SchedulingSessionRow | null;
  unavailable?: boolean;
  /** Nome dito na conversa; null = o cliente ainda não disse */
  customerName?: string | null;
  /** Nome do cadastro de clientes */
  registryName?: string | null;
  nameAskedAt?: Date | null;
  messagesSinceAsk?: number;
  /** Nome que o interpretador devolve junto da intenção */
  name?: string | null;
  /** Horário cujo lembrete saiu e espera a resposta (specs/006) */
  reminded?: AppointmentRow | null;
  messagesSinceReminder?: number;
}) {
  const inputs: InterpretInput[] = [];
  const handled: { interpretation: Interpretation; knownName: string | null; mentionedService: string | null }[] = [];
  const asked: string[] = [];
  const histories: unknown[] = [];
  const savedNames: string[] = [];
  const askedAt: Date[] = [];
  const confirmed: string[] = [];
  const notes: string[] = [];
  const conversation = { id: "c1", phone: MESSAGE.phone, name: ".", customerName, nameAskedAt } as ConversationRow;
  const interpreter: Interpreter = {
    interpret: async (input) => {
      inputs.push(input);
      if (unavailable) throw new InterpreterUnavailable("Ollama fora do ar");
      return { intent: intent!, option: null, date: null, name, source: "model" };
    },
  };
  const flow = {
    handle: async (input: { interpretation: Interpretation; knownName: string | null; mentionedService: string | null }) => {
      const { interpretation } = input;
      handled.push(input);
      return interpretation.intent === "unclear" ? { reply: "handoff", handoff: true } : { reply: "do agendamento" };
    },
  } as unknown as SchedulingFlow;

  const reply = createSchedulingRouter({
    interpreter,
    flow,
    store: {
      getSession: async () => session,
      findReminderAwaiting: async () => reminded,
      confirm: async (id) => {
        confirmed.push(id);
        return null;
      },
    },
    inbox: {
      getConversation: async () => conversation,
      knownName: async (c) => c.customerName ?? registryName,
      setCustomerName: async (_id, n) => {
        savedNames.push(n);
        return null;
      },
      markNameAsked: async (_id, at) => {
        askedAt.push(at);
      },
      customerMessagesSince: async (_id, since) => (since === reminded?.reminderSentAt ? messagesSinceReminder : messagesSinceAsk),
      recordSystem: async (_id, text) => {
        notes.push(text);
        return null as never;
      },
      recentHistory: async () => [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: MESSAGE.text! },
      ],
    },
    connection: { getForUse: async () => ({ refreshToken: "t", calendarId: "primary", timeZone: "America/Bahia", status: "connected" }) },
    rules: { get: async () => DEFAULT_RULES },
    answerQuestion: async (q, _log, _phone, history) => {
      histories.push(history);
      asked.push(q);
      return "do folheto";
    },
  });
  return { reply: () => reply({ conversationId: "c1", message: MESSAGE }, log), inputs, handled, asked, histories, savedNames, askedAt, confirmed, notes };
}

test("sem etapa, dúvida vai para o folheto", async () => {
  const r = setup({ intent: "question" });
  assert.deepEqual(await r.reply(), { text: "do folheto", split: true });
  assert.deepEqual(r.asked, ["How much are braces?"]);
  assert.equal(r.handled.length, 0);
});

test("sem etapa, intenção que não começa um fluxo também vai para o folheto", async () => {
  for (const intent of ["unclear", "yes", "choose"] as const) {
    const r = setup({ intent });
    assert.deepEqual(await r.reply(), { text: "do folheto", split: true });
  }
});

test("sem etapa, pedido de agendamento vai para o fluxo", async () => {
  const r = setup({ intent: "book" });
  assert.deepEqual(await r.reply(), { text: "do agendamento", ignorePause: undefined });
  assert.equal(r.handled[0].interpretation.intent, "book");
});

test("com etapa, dúvida vai para o folheto e a etapa continua; o resto vai para o fluxo", async () => {
  const q = setup({ intent: "question", session: SESSION });
  assert.deepEqual(await q.reply(), { text: "do folheto", split: true });
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
  assert.deepEqual(await setup({ unavailable: true }).reply(), { text: "do folheto", split: true });
  assert.deepEqual(await setup({ unavailable: true, session: SESSION }).reply(), { text: UNAVAILABLE_MESSAGE });
});

test("o folheto recebe o histórico sem a mensagem atual", async () => {
  const r = setup({ intent: "question" });
  await r.reply();
  assert.deepEqual(r.histories[0], [
    { role: "user", content: "hi" },
    { role: "assistant", content: "Hello!" },
  ]);
});

test("despedida sem etapa: só se despede, sem folheto nem fluxo", async () => {
  const r = setup({ intent: "goodbye" });
  const { text } = (await r.reply())!;
  assert.ok(/welcome|anytime|pleasure|glad/i.test(text), text);
  assert.ok(!/schedule|assessment/i.test(text));
  assert.equal(r.asked.length, 0);
  assert.equal(r.handled.length, 0);
});

test("despedida no meio de um agendamento encerra o agendamento", async () => {
  const r = setup({ intent: "goodbye", session: SESSION });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "stop");
});

// --- Nome do cliente (specs/005, US1) ---

const ASK = /may I have your name\?|what's your name\?/;

test("sem nome conhecido nem pedido anterior: a resposta do folheto vem com o pedido de nome, uma vez", async () => {
  const r = setup({ intent: "question", customerName: null });
  const reply = await r.reply();
  assert.equal(reply?.text, "do folheto");
  assert.match(reply?.followUp ?? "", ASK);
  assert.equal(r.askedAt.length, 1);
});

test("nome já pedido, ou já conhecido: sem novo pedido", async () => {
  for (const r of [
    setup({ intent: "question", customerName: null, nameAskedAt: new Date("2026-10-20T10:00:00Z"), messagesSinceAsk: 3 }),
    setup({ intent: "question" }),
  ]) {
    assert.equal((await r.reply())?.followUp, undefined);
    assert.equal(r.askedAt.length, 0);
  }
});

test("despedida e agendamento nunca levam o pedido de nome", async () => {
  for (const intent of ["goodbye", "book"] as const) {
    const r = setup({ intent, customerName: null });
    assert.equal((await r.reply())?.followUp, undefined, intent);
  }
});

test("o cliente só diz o nome: fica gravado e a resposta é a de nome recebido, sem o folheto", async () => {
  const r = setup({ intent: "give_name", name: "Maria", customerName: null, nameAskedAt: new Date() });
  const reply = await r.reply();
  assert.match(reply?.text ?? "", /Maria/);
  assert.deepEqual(r.savedNames, ["Maria"]);
  assert.equal(r.asked.length, 0);
});

test("nome junto de uma pergunta: grava o nome e responde pelo folheto, sem pedir o nome", async () => {
  const r = setup({ intent: "question", name: "Maria", customerName: null, nameAskedAt: new Date() });
  const reply = await r.reply();
  assert.deepEqual(reply, { text: "do folheto", split: true });
  assert.deepEqual(r.savedNames, ["Maria"]);
});

test("cliente do cadastro numa conversa nova: o nome vai para a conversa e para o agendamento, sem pedido", async () => {
  const r = setup({ intent: "book", customerName: null, registryName: "Maria Souza" });
  await r.reply();
  assert.deepEqual(r.savedNames, ["Maria Souza"]);
  assert.equal(r.handled[0].knownName, "Maria Souza");
});

test("o interpretador sabe que o nome foi pedido só na primeira mensagem depois do pedido", async () => {
  const asked = new Date("2026-10-20T10:00:00Z");
  const first = setup({ intent: "question", customerName: null, nameAskedAt: asked, messagesSinceAsk: 1 });
  await first.reply();
  assert.equal(first.inputs[0].awaitingName, true);
  const later = setup({ intent: "question", customerName: null, nameAskedAt: asked, messagesSinceAsk: 2 });
  await later.reply();
  assert.equal(later.inputs[0].awaitingName, false);
  const never = setup({ intent: "question", customerName: null });
  await never.reply();
  assert.equal(never.inputs[0].awaitingName, false);
});

test("o tratamento citado pelo cliente na conversa vai para o agendamento (specs/005 US2)", async () => {
  // A mensagem atual é "How much are braces?"
  const r = setup({ intent: "book" });
  await r.reply();
  assert.equal(r.handled[0].mentionedService, "Braces and Orthodontic Treatment");
});

// --- Resposta ao lembrete (specs/006 US4) ---

const REMINDED = {
  id: "a1",
  startsAt: new Date("2026-10-21T13:00:00Z"),
  reminderSentAt: new Date("2026-10-20T13:00:00Z"),
} as AppointmentRow;

test("lembrete enviado + YES: confirma, registra e agradece pelo nome, sem abrir fluxo", async () => {
  const r = setup({ intent: "yes", reminded: REMINDED });
  assert.deepEqual(await r.reply(), {
    text: "Thank you, Maria! Your appointment on Wed, Oct 21 at 10:00 AM is confirmed. See you at DentalSafe.",
  });
  assert.equal(r.inputs[0].awaitingReminder, true);
  assert.deepEqual(r.confirmed, ["a1"]);
  assert.deepEqual(r.notes, ["✅ Appointment confirmed by the customer: Wed, Oct 21 at 10:00 AM"]);
  assert.equal(r.handled.length, 0);
});

test("lembrete enviado + NO: vira a pergunta de remarcação do fluxo", async () => {
  const r = setup({ intent: "no", reminded: REMINDED });
  assert.deepEqual(await r.reply(), { text: "do agendamento", ignorePause: undefined });
  assert.equal(r.handled[0].interpretation.intent, "book");
  assert.deepEqual(r.confirmed, []);
});

test("lembrete enviado + cancelar: segue para o fluxo como sempre", async () => {
  const r = setup({ intent: "cancel", reminded: REMINDED });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "cancel");
  assert.deepEqual(r.confirmed, []);
});

test("com agendamento em andamento, o YES vale para a pergunta aberta, não para o lembrete", async () => {
  const r = setup({ intent: "yes", reminded: REMINDED, session: { ...SESSION, step: "confirm_booking" } as SchedulingSessionRow });
  await r.reply();
  assert.equal(r.inputs[0].awaitingReminder, false);
  assert.deepEqual(r.confirmed, []);
  assert.equal(r.handled[0].interpretation.intent, "yes");
});

test("o cliente já mandou outras mensagens depois do lembrete: um yes solto não confirma", async () => {
  const r = setup({ intent: "yes", reminded: REMINDED, messagesSinceReminder: 3 });
  await r.reply();
  assert.equal(r.inputs[0].awaitingReminder, false);
  assert.deepEqual(r.confirmed, []);
});
