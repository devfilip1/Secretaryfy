import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionOption } from "../../db/schema.js";
import { testCatalog } from "../../test/catalog.js";
import { ASSESSMENT } from "./catalog.js";
import { testClinic } from "../../test/clinic.js";
import { createInterpreter, nameInText, type InterpretInput } from "./interpret.js";
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
  const interpreter = createInterpreter({ clinic: testClinic, catalog: testCatalog, ollama: createOllamaClient({ url: "http://ollama.test", model: "m", timeoutMs: 1000, fetch }) });
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
    awaitingName: false,
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

test("pedido sem dia: a data de hoje devolvida pelo modelo vira null; com \"today\" na frase, vale", async () => {
  const { interpreter } = fakeOllama({ intent: "book", option: null, date: "2026-10-20", name: null });

  const semDia = await interpreter.interpret(input({ text: "I'd like to book an appointment" }));
  assert.equal(semDia.intent, "book");
  assert.equal(semDia.date, null);

  const hoje = await interpreter.interpret(input({ text: "I want to book something for today" }));
  assert.equal(hoje.date, "2026-10-20");

  // outra data, mesmo sem citação na frase, continua valendo
  const { interpreter: outro } = fakeOllama({ intent: "book", option: null, date: "2026-10-27", name: null });
  assert.equal((await outro.interpret(input({ text: "I'd like to book an appointment in a week" }))).date, "2026-10-27");
});

test("choose sem opções na tela vira book com a data citada, ou unclear sem data", async () => {
  const { interpreter } = fakeOllama({ intent: "choose", option: null, date: "2026-10-21", name: null });
  const comData = await interpreter.interpret(input({ text: "I'd like an appointment on Wednesday" }));
  assert.equal(comData.intent, "book");
  assert.equal(comData.date, "2026-10-21");

  const { interpreter: semData } = fakeOllama({ intent: "choose", option: null, date: null, name: null });
  assert.equal((await semData.interpret(input({ text: "that one" }))).intent, "unclear");

  // com opções na tela, choose continua choose
  const { interpreter: comOpcoes } = fakeOllama({ intent: "choose", option: 2, date: null, name: null });
  assert.equal((await comOpcoes.interpret(input({ text: "the second one please", step: "choose_day", options: days }))).intent, "choose");
});

test("o prompt manda a data ser null quando o cliente não diz um dia", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "unclear", option: null, date: null, name: null });
  await interpreter.interpret(input({ text: "hmm" }));
  const system = bodies[0].messages[0].content;
  assert.match(system, /names no day, so its date is null/);
});

test("a data citada na frase substitui a data errada do modelo", async () => {
  // O modelo diz sábado; a frase diz domingo
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: "2026-10-24", name: null });
  const r = await interpreter.interpret(input({ text: "Do you have openings on Sunday?" }));
  assert.equal(r.intent, "availability");
  assert.equal(r.date, "2026-10-25");
});

test("agradecimento ou despedida vira goodbye sem o modelo; com pergunta junto, vai para o modelo", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "question", option: null, date: null, name: null });

  for (const text of ["right, thank you so much, by", "Thanks!", "ok bye", "that's all, thank you, have a nice day", "obrigado"]) {
    assert.equal((await interpreter.interpret(input({ text }))).intent, "goodbye", text);
  }
  // Na confirmação, "ok thanks" continua sendo um sim
  assert.equal((await interpreter.interpret(input({ text: "ok thanks", step: "confirm_booking" }))).intent, "yes");
  assert.equal(bodies.length, 0);

  assert.equal((await interpreter.interpret(input({ text: "thanks, and how much is whitening?" }))).intent, "question");
  assert.equal(bodies.length, 1);
});

test("nome: 'my name is' e 'call me' valem em qualquer momento, sem o modelo", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "question", option: null, date: null, name: null });
  const name = async (text: string, awaitingName = false) => {
    const r = await interpreter.interpret(input({ text, awaitingName }));
    return r.intent === "give_name" ? r.name : null;
  };

  assert.equal(await name("My name is maria souza"), "Maria Souza");
  assert.equal(await name("call me Bia!"), "Bia");
  assert.equal(bodies.length, 0);
});

test("nome: o que não é nome vai para o modelo e não vira nome", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "question", option: null, date: null, name: null });
  for (const text of ["why?", "no", "hello", "Braces", "how much is it", "👍", "Maria Clara de Souza Lima Santos"]) {
    const r = await interpreter.interpret(input({ text, awaitingName: true }));
    assert.notEqual(r.intent, "give_name", text);
    assert.equal(r.name, null, text);
  }
  // Sem o pedido de nome, uma palavra solta não é nome
  assert.notEqual((await interpreter.interpret(input({ text: "Maria" }))).intent, "give_name");
  assert.ok(bodies.length > 0);
});

test("nome junto de outra intenção vem do modelo só logo depois do pedido", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "question", option: null, date: null, name: "maria" });
  const after = await interpreter.interpret(input({ text: "I'm Maria, how much is whitening", awaitingName: true }));
  assert.equal(after.intent, "question");
  assert.equal(after.name, "Maria");
  assert.match(bodies[0].messages[0].content, /has just asked the customer's name/);

  const without = await interpreter.interpret(input({ text: "how much is whitening for Maria?" }));
  assert.equal(without.name, null);
  assert.doesNotMatch(bodies[1].messages[0].content, /has just asked the customer's name/);
});

test("give_name do modelo sem um nome válido vira unclear", async () => {
  const { interpreter } = fakeOllama({ intent: "give_name", option: null, date: null, name: "why" });
  assert.equal((await interpreter.interpret(input({ text: "why do you ask?", awaitingName: true }))).intent, "unclear");
});

// --- specs/005, US2: serviço ---

test("etapa choose_service: o número da lista vale sem o modelo; o nome do tratamento é o modelo que lê, pelo rótulo", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "choose_service", option: null, date: null, name: null, service: "Teeth Whitening" });
  const pick = async (text: string) => {
    const r = await interpreter.interpret(input({ text, step: "choose_service" }));
    return [r.intent, r.service ?? null];
  };
  assert.deepEqual(await pick("3"), ["choose_service", "Dental Filling"]);
  assert.deepEqual(await pick("10"), ["unclear", null]);
  assert.equal(bodies.length, 0);
  assert.deepEqual(await pick("whitening please"), ["choose_service", "Teeth Whitening"]);
  assert.equal(bodies.length, 1);
  // O enum do serviço tem os rótulos do catálogo e null
  const format = bodies[0].format as { properties: { service: { enum: unknown[] } } };
  assert.ok(format.properties.service.enum.includes("Teeth Whitening"));
  // null vem primeiro: na dúvida o modelo não escolhe o primeiro tratamento da lista
  assert.equal(format.properties.service.enum[0], null);
  // "não sei" é a avaliação geral, com o rótulo em inglês que o modelo devolve
  const assess = fakeOllama({ intent: "choose_service", option: null, date: null, name: null, service: "General assessment" });
  assert.deepEqual(await assess.interpreter.interpret(input({ text: "not sure", step: "choose_service" })).then((r) => [r.intent, r.service]), ["choose_service", ASSESSMENT]);
});

test("o serviço que o modelo dá vale em qualquer intenção; fora do catálogo, nenhum", async () => {
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: null, name: null, service: "Braces and Orthodontic Treatment" });
  const r = await interpreter.interpret(input({ text: "do you have times for braces on Friday?" }));
  assert.equal(r.intent, "availability");
  assert.equal(r.service, "Braces and Orthodontic Treatment");
  const other = fakeOllama({ intent: "availability", option: null, date: null, name: null, service: "hair transplant" });
  assert.equal((await other.interpreter.interpret(input({ text: "times for hair?" }))).service, undefined);
});

test("no resumo, citar outro tratamento troca o serviço; sim continua sim", async () => {
  const { interpreter } = fakeOllama({ intent: "choose_service", option: null, date: null, name: null, service: "Dental Cleaning" });
  const r = await interpreter.interpret(input({ text: "actually I want a cleaning", step: "confirm_booking" }));
  assert.equal(r.intent, "choose_service");
  assert.equal(r.service, "Dental Cleaning");
  assert.equal((await interpreter.interpret(input({ text: "yes", step: "confirm_booking" }))).intent, "yes");
});

test("choose_service do modelo só vale com um serviço do catálogo", async () => {
  const ok = fakeOllama({ intent: "choose_service", option: null, date: null, name: null, service: "teeth whitening" });
  const r = await ok.interpreter.interpret(input({ text: "the white one", step: "choose_service" }));
  assert.equal(r.intent, "choose_service");
  assert.equal(r.service, "Teeth Whitening");
  const bad = fakeOllama({ intent: "choose_service", option: null, date: null, name: null, service: "hair transplant" });
  assert.equal((await bad.interpreter.interpret(input({ text: "the hair one", step: "choose_service" }))).intent, "unclear");
});

test("resposta ao lembrete (specs/006): YES e variações confirmam, NO recusa, sem chamar o modelo", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "unclear", option: null, date: null, name: null });
  const reminder = (text: string) => interpreter.interpret(input({ text, awaitingReminder: true }));
  for (const text of ["YES", "yes!", "Confirmed", "I'll be there", "see you", "ok"]) assert.equal((await reminder(text)).intent, "yes", text);
  for (const text of ["no", "Nope"]) assert.equal((await reminder(text)).intent, "no", text);
  assert.equal(bodies.length, 0);
});

test("sem lembrete, um yes solto não vira sim pelas regras; com lembrete, o prompt explica o contexto", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "cancel", option: null, date: null, name: null });
  assert.notEqual((await interpreter.interpret(input({ text: "I'll be there" }))).source, "rule");
  assert.equal(bodies.length, 1);
  assert.doesNotMatch(bodies[0].messages[0].content, /reminded the customer/);

  const cancel = await interpreter.interpret(input({ text: "cancel my appointment please", awaitingReminder: true }));
  assert.equal(cancel.intent, "cancel");
  assert.match(bodies[1].messages[0].content, /reminded the customer of their appointment and asked them to reply YES/);
});

// --- nome: escrito na mensagem e nunca tirado de uma pergunta ---

test("etapa ask_name e logo depois do pedido: o modelo diz o nome, escrito como na mensagem", async () => {
  const cases: [string, string, Partial<InterpretInput>][] = [
    ["Maria Souza", "Maria Souza", { step: "ask_name" }],
    ["I'm Maria", "Maria", { awaitingName: true }],
    ["it's maria", "Maria", { awaitingName: true }],
    ["maria", "Maria", { awaitingName: true }],
    ["Maria Clara Souza", "Maria Clara Souza", { awaitingName: true }],
  ];
  for (const [text, name, overrides] of cases) {
    const { interpreter } = fakeOllama({ intent: "give_name", option: null, date: null, name });
    const r = await interpreter.interpret(input({ text, ...overrides }));
    assert.deepEqual([r.intent, r.name], ["give_name", name], text);
  }
});

test("nome do modelo que não está na mensagem, ou sai de uma pergunta, não vale", async () => {
  const pergunta = fakeOllama({ intent: "give_name", option: null, date: null, name: "Voces" }).interpreter;
  const r1 = await pergunta.interpret(input({ text: "voces aceitam cartão?" }));
  assert.notEqual(r1.intent, "give_name");
  assert.equal(r1.name, null);

  const inventado = fakeOllama({ intent: "give_name", option: null, date: null, name: "Dor De Dente" }).interpreter;
  assert.equal((await inventado.interpret(input({ text: "Carla", awaitingName: true }))).name, null);
});

test("logo depois do pedido, uma pergunta com o nome na primeira linha ainda traz o nome", async () => {
  const { interpreter } = fakeOllama({ intent: "question", option: null, date: null, name: "carla" });
  const r = await interpreter.interpret(input({ text: "carla\\nquanto custa a limpeza", awaitingName: true }));
  assert.equal(r.name, "Carla");
});

test("nameInText ignora acento e caixa e exige todas as palavras do nome", () => {
  assert.equal(nameInText("José", "jose aqui"), true);
  assert.equal(nameInText("José Silva", "José"), false);
});

// --- tratamento citado na conversa: uma chamada focada, sem regras por palavra ---

test("mentionedService devolve o tratamento que o modelo escolheu, pelo rótulo do catálogo, sem a avaliação geral na lista", async () => {
  const { interpreter, bodies } = fakeOllama({ service: "Dental Cleaning", quote: "dental cleaning" });
  const history: ChatMessage[] = [
    { role: "user", content: "Do you do dental cleaning?" },
    { role: "assistant", content: "Yes, we do." },
  ];
  assert.equal(await interpreter.mentionedService({ history, text: "I'd like to book an appointment" }), "Dental Cleaning");

  const body = bodies[0];
  assert.equal(body.options.temperature, 0);
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /Do not guess/);
  assert.deepEqual(body.messages.slice(1), [...history, { role: "user", content: "I'd like to book an appointment" }]);
  const format = body.format as { properties: { service: { enum: unknown[] } }; required: string[] };
  assert.ok(format.properties.service.enum.includes("Teeth Whitening"));
  assert.ok(!format.properties.service.enum.includes("General assessment"));
  assert.deepEqual(format.required, ["quote", "service"]);
});

test("mentionedService só vale com a citação escrita pelo cliente: sem citação, ou com uma que não está na conversa, é null", async () => {
  const history: ChatMessage[] = [{ role: "user", content: "How much is teeth whitening?" }];
  const noQuote = fakeOllama({ service: "Teeth Whitening", quote: null }).interpreter;
  assert.equal(await noQuote.mentionedService({ history, text: "I want to book" }), null);
  const invented = fakeOllama({ service: "Dental Cleaning", quote: "dental cleaning" }).interpreter;
  assert.equal(await invented.mentionedService({ history, text: "I want to book" }), null);
  const grounded = fakeOllama({ service: "Teeth Whitening", quote: "Teeth Whitening" }).interpreter;
  assert.equal(await grounded.mentionedService({ history, text: "I want to book" }), "Teeth Whitening");
  // Só as mensagens do cliente contam: a resposta do assistente não prova nada
  const assistantOnly = fakeOllama({ service: "Dental Cleaning", quote: "dental cleaning" }).interpreter;
  const h2: ChatMessage[] = [{ role: "assistant", content: "A dental cleaning takes 30 minutes." }];
  assert.equal(await assistantOnly.mentionedService({ history: h2, text: "I want to book" }), null);
});

test("mentionedService: null, rótulo fora do catálogo, avaliação geral, JSON inválido ou Ollama fora do ar viram null sem lançar", async () => {
  const none = fakeOllama({ service: null, quote: null }).interpreter;
  assert.equal(await none.mentionedService({ history: [], text: "hi there" }), null);
  const unknown = fakeOllama({ service: "hair transplant", quote: "hair" }).interpreter;
  assert.equal(await unknown.mentionedService({ history: [], text: "hair?" }), null);
  const assessment = fakeOllama({ service: "General assessment", quote: "not sure" }).interpreter;
  assert.equal(await assessment.mentionedService({ history: [], text: "not sure" }), null);
  const broken = fakeOllama("isto não é json").interpreter;
  assert.equal(await broken.mentionedService({ history: [], text: "hmm" }), null);

  const logged: object[] = [];
  const down = fakeOllama(() => {
    throw new TypeError("fetch failed");
  }).interpreter;
  const log = { error: (obj: object) => logged.push(obj) };
  assert.equal(await down.mentionedService({ history: [], text: "hmm", log }), null);
  assert.equal(logged.length, 1);
});
