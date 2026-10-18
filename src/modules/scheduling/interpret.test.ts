import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionOption } from "../../db/schema.js";
import { createInterpreter, type InterpretInput } from "./interpret.js";
import { createOllamaClient, InterpreterUnavailable, type ChatMessage } from "./ollama.js";

type Body = { model: string; format: object; options: { temperature: number }; stream: boolean; messages: ChatMessage[] };

/** Ollama falso: guarda o corpo recebido e devolve `reply` como conteúdo da mensagem. */
function fakeOllama(reply: unknown | (() => never)) {
  const bodies: Body[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    if (typeof reply === "function") (reply as () => never)();
    return new Response(JSON.stringify({ message: { role: "assistant", content: typeof reply === "string" ? reply : JSON.stringify(reply) } }));
  }) as typeof globalThis.fetch;
  const interpreter = createInterpreter({ ollama: createOllamaClient({ url: "http://ollama.test", model: "m", timeoutMs: 1000, fetch }) });
  return { interpreter, bodies };
}

const days: SessionOption[] = [
  { n: 1, kind: "day", date: "2026-10-21" },
  { n: 2, kind: "day", date: "2026-10-22" },
  { n: 3, kind: "day", date: "2026-10-23" },
];

function input(overrides: Partial<InterpretInput> = {}): InterpretInput {
  return {
    text: "",
    step: null,
    options: [],
    history: [],
    // Terça, 20/10/2026, 15:00 em Salvador
    now: new Date("2026-10-20T18:00:00Z"),
    timeZone: "America/Bahia",
    window: { firstDate: "2026-10-20", lastDate: "2026-11-19" },
    ...overrides,
  };
}

test("regras resolvem números, sim/não e datas simples sem chamar o modelo", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "unclear", option: null, date: null, name: null });

  assert.deepEqual(await interpreter.interpret(input({ text: " 2 ", step: "choose_day", options: days })), {
    intent: "choose", option: 2, date: null, name: null, source: "rule",
  });
  assert.equal((await interpreter.interpret(input({ text: "7", step: "choose_day", options: days }))).intent, "unclear");
  assert.equal((await interpreter.interpret(input({ text: "Yes!", step: "confirm_booking" }))).intent, "yes");
  assert.equal((await interpreter.interpret(input({ text: "nope", step: "confirm_cancel" }))).intent, "no");
  assert.equal((await interpreter.interpret(input({ text: "more", step: "choose_slot", options: days }))).intent, "more");
  assert.equal((await interpreter.interpret(input({ text: "another day", step: "choose_slot", options: days }))).intent, "other_day");
  assert.deepEqual(await interpreter.interpret(input({ text: "tomorrow" })), {
    intent: "availability", option: null, date: "2026-10-21", name: null, source: "rule",
  });
  assert.deepEqual(await interpreter.interpret(input({ text: "Friday", step: "choose_day", options: days })), {
    intent: "choose", option: null, date: "2026-10-23", name: null, source: "rule",
  });
  assert.deepEqual(await interpreter.interpret(input({ text: "Maria Souza", step: "ask_name" })), {
    intent: "give_name", option: null, date: null, name: "Maria Souza", source: "rule",
  });
  assert.equal(bodies.length, 0);
});

test("o modelo recebe schema, temperatura 0, a data de hoje, a etapa, as opções e no máximo 20 mensagens", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "book", option: null, date: null, name: null });
  const history: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));

  const result = await interpreter.interpret(input({ text: "I'd like to book an appointment", history, step: "choose_day", options: days }));
  assert.deepEqual(result, { intent: "book", option: null, date: null, name: null, source: "model" });

  const body = bodies[0];
  assert.equal(body.model, "m");
  assert.equal(body.stream, false);
  assert.equal(body.options.temperature, 0);
  assert.ok("properties" in body.format);
  const system = body.messages[0];
  assert.equal(system.role, "system");
  assert.match(system.content, /Tuesday, 2026-10-20/);
  assert.match(system.content, /choose_day/);
  assert.match(system.content, /2\. .*2026-10-22/);
  // system + 20 de histórico + a mensagem atual
  assert.equal(body.messages.length, 22);
  assert.equal(body.messages[1].content, "m10");
  assert.deepEqual(body.messages.at(-1), { role: "user", content: "I'd like to book an appointment" });
});

test("saída do modelo inválida vira unclear; data além do limite vira tooFar", async () => {
  const cases: [unknown, Partial<InterpretInput>, string][] = [
    [{ intent: "dance", option: null, date: null, name: null }, {}, "unclear"],
    [{ intent: "choose", option: 9, date: null, name: null }, { step: "choose_day", options: days }, "unclear"],
    [{ intent: "choose", option: null, date: null, name: null }, { step: "choose_day", options: days }, "unclear"],
    [{ intent: "availability", option: null, date: "2026-02-30", name: null }, {}, "unclear"],
    [{ intent: "availability", option: null, date: "2026-10-01", name: null }, {}, "unclear"],
    ["isto não é json", {}, "unclear"],
  ];
  for (const [reply, overrides, expected] of cases) {
    const { interpreter } = fakeOllama(reply);
    // Texto que nenhuma regra resolve, para chegar ao modelo
    assert.equal((await interpreter.interpret(input({ text: "hmm well", ...overrides }))).intent, expected, JSON.stringify(reply));
  }

  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: "2027-03-01", name: null });
  const far = await interpreter.interpret(input({ text: "anything in March?" }));
  assert.equal(far.intent, "availability");
  assert.equal(far.tooFar, true);
});

test("Ollama fora do ar ou lento: InterpreterUnavailable", async () => {
  const { interpreter } = fakeOllama(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(interpreter.interpret(input({ text: "hello there" })), InterpreterUnavailable);
});

test("horário em texto escolhe a opção oferecida, sem o modelo", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "unclear", option: null, date: null, name: null });
  const slots: SessionOption[] = [
    { n: 1, kind: "slot", start: "2026-10-21T12:00:00.000Z" },
    { n: 2, kind: "slot", start: "2026-10-21T13:00:00.000Z" },
  ];
  const r = await interpreter.interpret(input({ text: "the 10 am one", step: "choose_slot", options: slots }));
  assert.deepEqual(r, { intent: "choose", option: 2, date: null, name: null, source: "rule" });
  assert.equal(bodies.length, 0);
});

test("a data citada na frase substitui a data errada do modelo", async () => {
  // O modelo diz sábado; a frase diz domingo
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: "2026-10-24", name: null });
  const r = await interpreter.interpret(input({ text: "Do you have openings on Sunday?" }));
  assert.equal(r.intent, "availability");
  assert.equal(r.date, "2026-10-25");
});
