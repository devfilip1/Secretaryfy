import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionOption } from "../../db/schema.js";
import { testCatalog } from "../../test/catalog.js";
import { ASSESSMENT, createCatalog, type ServiceCatalog } from "./catalog.js";
import { testClinic } from "../../test/clinic.js";
import { createInterpreter, nameInText, type InterpretInput } from "./interpret.js";
import { createOllamaClient, InterpreterUnavailable, type ChatMessage } from "./ollama.js";

type Body = { model: string; format: object; options: { temperature: number }; stream: boolean; messages: ChatMessage[] };

/** Ollama falso: guarda o corpo recebido e devolve `reply` como conteúdo da mensagem. */
function fakeOllama(reply: unknown | (() => never), catalog: ServiceCatalog = testCatalog) {
  const bodies: Body[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    if (typeof reply === "function") (reply as () => never)();
    return new Response(JSON.stringify({ message: { role: "assistant", content: typeof reply === "string" ? reply : JSON.stringify(reply) } }));
  }) as typeof globalThis.fetch;
  const interpreter = createInterpreter({ clinic: testClinic, catalog, ollama: createOllamaClient({ url: "http://ollama.test", model: "m", timeoutMs: 1000, fetch }) });
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

// Horários de 19/11 na tela (Salvador, UTC-3): 10:00 a 15:00
const slotsOnScreen: SessionOption[] = [10, 11, 12, 13, 14, 15].map((h, k) => ({ n: k + 1, kind: "slot", start: `2026-11-19T${String(h + 3).padStart(2, "0")}:00:00.000Z` }) as SessionOption);

test("pergunta sobre quais horários existem na tela é disponibilidade com janela, nunca pergunta (qualquer jeito de dizer)", async () => {
  const cases: { text: string; notBefore?: string; notAfter?: string }[] = [
    { text: "teria mais cedo que 9?", notAfter: "09:00" },
    { text: "tem algo antes das 10?", notAfter: "10:00" },
    { text: "e depois das 15?", notBefore: "15:00" },
  ];
  for (const { text, notBefore, notAfter } of cases) {
    // O modelo errou a intenção (question) e pôs a janela: o código a aceita como pedido de horário
    const { interpreter } = fakeOllama({ intent: "question", option: null, date: null, name: null, timeWindow: { after: notBefore ?? null, before: notAfter ?? null, near: null, pick: null } });
    const i = await interpreter.interpret(input({ text, step: "choose_slot", options: slotsOnScreen }));
    assert.equal(i.intent, "availability", text);
    assert.equal(i.timeWindow?.notBefore ?? null, notBefore ?? null, text);
    assert.equal(i.timeWindow?.notAfter ?? null, notAfter ?? null, text);
  }
});

// O modelo pôs o mesmo horário no campo de horário e na ponta "antes": a janela vale, e não é um horário exato
test("disponibilidade com uma ponta de janela não traz horário exato", async () => {
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: null, name: null, time: "11:00", timeWindow: { after: null, before: "11:00", near: null, pick: null } });
  const i = await interpreter.interpret(input({ text: "pode ser antes das 11?", step: "choose_slot", options: slotsOnScreen }));
  assert.equal(i.intent, "availability");
  assert.equal(i.time, undefined);
  assert.equal(i.timeWindow?.notAfter, "11:00");
});

test("pergunta de informação da clínica, sem janela, continua pergunta mesmo com horários na tela", async () => {
  const { interpreter } = fakeOllama({ intent: "question", option: null, date: null, name: null, timeWindow: null });
  const i = await interpreter.interpret(input({ text: "quanto custa a limpeza?", step: "choose_slot", options: slotsOnScreen }));
  assert.equal(i.intent, "question");
});

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

test("um sim ou um não depois do pedido de nome não é o nome", async () => {
  for (const [text, name] of [["sim", "Sim"], ["Sim", "Sim"], ["não", "Não"], ["yes", "Yes"], ["ok", "Ok"]]) {
    const { interpreter } = fakeOllama({ intent: "give_name", option: null, date: null, name });
    const r = await interpreter.interpret(input({ text, step: "ask_name", awaitingName: true }));
    assert.notEqual(r.intent, "give_name", text);
    assert.equal(r.name, null, text);
  }
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

test("mentionedService devolve o tratamento que o modelo escolheu, pelo rótulo do catálogo, com a avaliação geral na lista", async () => {
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
  assert.ok(format.properties.service.enum.includes("General assessment"));
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

test("mentionedService: null, rótulo fora do catálogo, JSON inválido ou Ollama fora do ar viram null sem lançar", async () => {
  const none = fakeOllama({ service: null, quote: null }).interpreter;
  assert.equal(await none.mentionedService({ history: [], text: "hi there" }), null);
  const unknown = fakeOllama({ service: "hair transplant", quote: "hair" }).interpreter;
  assert.equal(await unknown.mentionedService({ history: [], text: "hair?" }), null);
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

test("avaliação geral: vale só quando o cliente a nomeia com a citação dele; sem citação, fora das mensagens, ou não oferecida, é null", async () => {
  const named = fakeOllama({ service: "General assessment", quote: "avaliação geral" }).interpreter;
  assert.equal(await named.mentionedService({ history: [], text: "Oi, queria marcar uma avaliação geral" }), ASSESSMENT);
  const unquoted = fakeOllama({ service: "General assessment", quote: null }).interpreter;
  assert.equal(await unquoted.mentionedService({ history: [], text: "quero marcar uma consulta" }), null);
  const invented = fakeOllama({ service: "General assessment", quote: "check-up" }).interpreter;
  assert.equal(await invented.mentionedService({ history: [], text: "quero marcar uma consulta" }), null);

  const treatments = testCatalog.list().filter((s) => s.name !== ASSESSMENT);
  const notOffered = createCatalog(treatments, { offerAssessment: false, offerFollowUp: false, assessmentMinutes: null, followUpMinutes: null });
  const off = fakeOllama({ service: "General assessment", quote: "avaliação geral" }, notOffered);
  assert.equal(await off.interpreter.mentionedService({ history: [], text: "queria marcar uma avaliação geral" }), null);
});

test("avaliação geral não oferecida sai do enum do pedido focado", async () => {
  const treatments = testCatalog.list().filter((s) => s.name !== ASSESSMENT);
  const notOffered = createCatalog(treatments, { offerAssessment: false, offerFollowUp: false, assessmentMinutes: null, followUpMinutes: null });
  const { interpreter, bodies } = fakeOllama({ service: null, quote: null }, notOffered);
  await interpreter.mentionedService({ history: [], text: "oi" });
  const format = bodies[0].format as { properties: { service: { enum: unknown[] } } };
  assert.ok(!format.properties.service.enum.includes("General assessment"));
});

// --- sim ou não numa confirmação: o assunto lido pelo modelo não é sim; o interpretador só marca topicOnly (quem decide é a concordância) ---

test("confirmação de remarcação: 'pode sim camarada' lido como reschedule pelo modelo fica reschedule, marcado topicOnly", async () => {
  const { interpreter } = fakeOllama({ intent: "reschedule", option: null, date: null, name: null });
  const r = await interpreter.interpret(input({ text: "pode sim camarada", step: "confirm_reschedule" }));
  assert.deepEqual([r.intent, r.date, r.source, r.topicOnly], ["reschedule", null, "model", true]);
});

test("confirmação: o assunto não herda a data, o horário nem o tratamento que o modelo inventou", async () => {
  const { interpreter } = fakeOllama({ intent: "reschedule", option: null, date: "2026-10-27", time: "15:00", name: null, service: "Teeth Whitening" });
  const r = await interpreter.interpret(input({ text: "pode sim camarada", step: "confirm_reschedule" }));
  assert.deepEqual([r.intent, r.date, r.time, r.option, r.topicOnly], ["reschedule", null, undefined, null, true]);
});

test("confirmação de agendamento, de cancelamento e oferta de remarcação: o assunto lido pelo modelo fica a intenção dele, sem virar sim", async () => {
  const booking = fakeOllama({ intent: "book", option: null, date: null, name: null }).interpreter;
  assert.equal((await booking.interpret(input({ text: "pode sim", step: "confirm_booking" }))).intent, "book");
  const cancel = fakeOllama({ intent: "cancel", option: null, date: null, name: null }).interpreter;
  assert.equal((await cancel.interpret(input({ text: "pode sim", step: "confirm_cancel" }))).intent, "cancel");
  const offer = fakeOllama({ intent: "reschedule", option: null, date: null, name: null }).interpreter;
  assert.equal((await offer.interpret(input({ text: "pode sim", step: "offer_reschedule" }))).intent, "reschedule");
});

test("confirmação: 'não quero cancelar' lido como cancel também fica cancel, com topicOnly, nunca sim", async () => {
  const { interpreter } = fakeOllama({ intent: "cancel", option: null, date: null, name: null });
  const r = await interpreter.interpret(input({ text: "não quero cancelar", step: "confirm_cancel" }));
  assert.deepEqual([r.intent, r.topicOnly], ["cancel", true]);
});

test("confirmação: o assunto com um dia citado é pedido de mudança, não sim", async () => {
  const { interpreter } = fakeOllama({ intent: "reschedule", option: null, date: null, weekday: "wednesday", name: null });
  const r = await interpreter.interpret(input({ text: "melhor na quarta", step: "confirm_reschedule" }));
  assert.deepEqual([r.intent, r.date], ["reschedule", "2026-10-21"]);
});

test("confirmação: o assunto com um horário citado é pedido de mudança, não sim", async () => {
  const { interpreter } = fakeOllama({ intent: "book", option: null, date: null, name: null });
  assert.equal((await interpreter.interpret(input({ text: "pode ser às 15h", step: "confirm_booking" }))).intent, "book");
});

test("confirmação: o tratamento só conta como citado se estiver na frase", async () => {
  const { interpreter } = fakeOllama({ intent: "book", option: null, date: null, name: null, service: "Teeth Whitening" });
  const cited = await interpreter.interpret(input({ text: "pode sim, o Teeth Whitening", step: "confirm_booking" }));
  assert.equal(cited.intent, "book");
  const notCited = fakeOllama({ intent: "book", option: null, date: null, name: null, service: "Teeth Whitening" }).interpreter;
  assert.equal((await notCited.interpret(input({ text: "pode sim", step: "confirm_booking" }))).intent, "book");
});

test("confirmação: não continua não, sim continua sim, e fora da confirmação o assunto não muda", async () => {
  const { interpreter, bodies } = fakeOllama({ intent: "no", option: null, date: null, name: null });
  assert.equal((await interpreter.interpret(input({ text: "não, deixa como está", step: "confirm_reschedule" }))).intent, "no");

  assert.equal((await interpreter.interpret(input({ text: "sim", step: "confirm_booking" }))).intent, "yes");
  assert.equal(bodies.length, 1, "o 'sim' puro é regra, sem o modelo");

  const outside = fakeOllama({ intent: "reschedule", option: null, date: null, name: null }).interpreter;
  assert.equal((await outside.interpret(input({ text: "pode sim camarada", step: null }))).intent, "reschedule");
});

// Quarta, 11/11/2026, 18:00 em Salvador (já passou do horário): a lista oferece 12, 13, 14, 16, 17 e 18 de novembro
const novembro = {
  now: new Date("2026-11-11T21:00:00Z"),
  window: { firstDate: "2026-11-11", lastDate: "2026-12-11" },
  step: "choose_day" as const,
  options: [12, 13, 14, 16, 17, 18].map((day, i): SessionOption => ({ n: i + 1, kind: "day", date: `2026-11-${day}` })),
};

test("dia da semana citado com dia oferecido na lista: é a escolha, qualquer que seja a intenção de escolha do modelo", async () => {
  for (const intent of ["choose", "other_day", "book", "unclear"] as const) {
    const { interpreter } = fakeOllama({ intent, option: null, date: "2026-11-11", weekday: "wednesday", name: null });
    const r = await interpreter.interpret(input({ ...novembro, text: "quarta feira" }));
    assert.deepEqual([r.intent, r.option, r.date], ["choose", 6, "2026-11-18"], intent);
  }
});

test("data citada que é um dia oferecido é a escolha, mesmo com a intenção 'unclear' do modelo", async () => {
  const { interpreter } = fakeOllama({ intent: "unclear", option: null, date: null, weekday: null, name: null });
  const r = await interpreter.interpret(input({ ...novembro, text: "quarta dia 18" }));
  assert.deepEqual([r.intent, r.option, r.date], ["choose", 6, "2026-11-18"]);

  const { interpreter: outro } = fakeOllama({ intent: "book", option: null, date: null, weekday: "wednesday", name: null });
  assert.equal((await outro.interpret(input({ ...novembro, text: "quarta dia 18" }))).option, 6);
});

test("dia da semana sem dia oferecido com esse nome: vale a conta antiga, a partir de hoje", async () => {
  // Nenhum domingo na lista: o próximo domingo conta a partir de hoje (quarta 11 → domingo 15)
  const { interpreter } = fakeOllama({ intent: "choose", option: null, date: null, weekday: "sunday", name: null });
  const r = await interpreter.interpret(input({ ...novembro, text: "e domingo?" }));
  assert.deepEqual([r.intent, r.option, r.date], ["choose", null, "2026-11-15"]);
});

test("sim e não nunca viram escolha de dia, mesmo com dias na lista", async () => {
  const { interpreter: sim } = fakeOllama({ intent: "yes", option: null, date: null, weekday: null, name: null });
  assert.equal((await sim.interpret(input({ ...novembro, text: "sim" }))).intent, "yes");
  const { interpreter: nao } = fakeOllama({ intent: "unclear", option: null, date: null, weekday: null, name: null });
  const r = await nao.interpret(input({ ...novembro, text: "sim" }));
  assert.deepEqual([r.intent, r.option], ["unclear", null]);
});

test("dia da semana dito pelo nome, sem dia da semana do modelo: vale o dia oferecido com esse nome", async () => {
  // O modelo não devolveu dia da semana nem data útil: o nome na frase é que manda
  for (const raw of [
    { intent: "unclear", option: null, date: null, weekday: null, name: null },
    { intent: "choose", option: null, date: "2026-11-11", weekday: null, name: null },
  ]) {
    const { interpreter } = fakeOllama(raw);
    assert.deepEqual(
      (({ intent, option, date }) => [intent, option, date])(await interpreter.interpret(input({ ...novembro, text: "quarta feira" }))),
      ["choose", 6, "2026-11-18"],
    );
  }
  const { interpreter: sozinho } = fakeOllama({ intent: "choose", option: null, date: "2026-11-11", weekday: null, name: null });
  assert.deepEqual([(await sozinho.interpret(input({ ...novembro, text: "quarta" }))).option], [6]);
});

test("o modelo erra o nome do dia da semana (quinta para \"quarta feira\"): vale o nome dito na frase", async () => {
  const { interpreter } = fakeOllama({ intent: "choose", option: 1, date: "2026-11-12", weekday: "thursday", name: null });
  const r = await interpreter.interpret(input({ ...novembro, text: "quarta feira" }));
  assert.deepEqual([r.intent, r.option, r.date], ["choose", 6, "2026-11-18"]);
});

test("dia da semana dito pelo nome sem dia oferecido com esse nome: a conta antiga, a partir de hoje", async () => {
  // Nenhum domingo na lista; sem o dia da semana do modelo, 'domingo' é o próximo domingo (15/11)
  const { interpreter } = fakeOllama({ intent: "choose", option: null, date: null, weekday: null, name: null });
  const r = await interpreter.interpret(input({ ...novembro, text: "domingo" }));
  assert.deepEqual([r.intent, r.option, r.date], ["choose", null, "2026-11-15"]);
});

test("data explícita com o nome do dia não vira o dia do nome: 'quarta dia 25' fora da lista", async () => {
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: "2026-11-25", weekday: null, name: null });
  const r = await interpreter.interpret(input({ ...novembro, text: "quarta dia 25" }));
  assert.deepEqual([r.intent, r.option, r.date], ["availability", null, "2026-11-25"]);
});

test("fim de semana: o modelo diz 'weekend', e a interpretação é os dois dias, sem data (nem sábado)", async () => {
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: "2026-10-24", weekday: "weekend", name: null });
  const r = await interpreter.interpret(input({ text: "vocês atendem no fim de semana?" }));
  assert.deepEqual([r.intent, r.date, r.weekend], ["availability", null, true]);
});

test("sábado e domingo ditos juntos na frase: fim de semana, mesmo se o modelo devolve só sábado", async () => {
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: "2026-10-24", weekday: "saturday", name: null });
  const r = await interpreter.interpret(input({ text: "sábado e domingo" }));
  assert.deepEqual([r.date, r.weekend], [null, true]);
});

test("sábado sozinho continua sendo o sábado, sem fim de semana", async () => {
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: null, weekday: "saturday", name: null });
  const r = await interpreter.interpret(input({ text: "tem horario sab?" }));
  assert.deepEqual([r.date, r.weekend], ["2026-10-24", undefined]);
});

test("fim de semana numa lista de dias: não é a opção do sábado, é a escolha do fim de semana", async () => {
  const sabadoEDomingo = [24, 25].map((day, i): SessionOption => ({ n: i + 1, kind: "day", date: `2026-10-${day}` }));
  const { interpreter } = fakeOllama({ intent: "choose", option: 1, date: null, weekday: "weekend", name: null });
  const r = await interpreter.interpret(input({ step: "choose_day", options: sabadoEDomingo, text: "fim de semana" }));
  assert.deepEqual([r.intent, r.option, r.date, r.weekend], ["choose", null, null, true]);
});

test("'segunda de tarde' com 'weekend' do modelo: é a segunda, não o fim de semana", async () => {
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: null, weekday: "weekend", name: null });
  const r = await interpreter.interpret(input({ text: "quais horarios da segunda de tarde" }));
  // Terça, 20/10/2026: a próxima segunda é 26/10
  assert.deepEqual([r.intent, r.date, r.weekend], ["availability", "2026-10-26", undefined]);
});

test("'sábado de tarde' com 'weekend' do modelo: é só o sábado", async () => {
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: null, weekday: "weekend", name: null });
  const r = await interpreter.interpret(input({ text: "quais horarios no sabado de tarde" }));
  assert.deepEqual([r.date, r.weekend], ["2026-10-24", undefined]);
});

test("'quais horarios do fim de semana' sem dia nomeado: o 'weekend' do modelo vale", async () => {
  const { interpreter } = fakeOllama({ intent: "availability", option: null, date: null, weekday: "weekend", name: null });
  const r = await interpreter.interpret(input({ text: "quais horarios do fim de semana" }));
  assert.deepEqual([r.date, r.weekend], [null, true]);
});

// Quinta, 12/11/2026: a segunda lista oferece 19, 20, 21, 23, 24 e 25 de novembro
const proximaSemana = {
  now: new Date("2026-11-12T21:00:00Z"),
  window: { firstDate: "2026-11-12", lastDate: "2026-12-12" },
  step: "choose_day" as const,
  options: [19, 20, 21, 23, 24, 25].map((day, i): SessionOption => ({ n: i + 1, kind: "day", date: `2026-11-${day}` })),
};

test("'e na proxima quinta? dia 25 tem?': a data escrita vale mais que o dia da semana da mesma frase", async () => {
  for (const weekday of ["thursday", "wednesday", null] as const) {
    const { interpreter } = fakeOllama({ intent: "choose", option: 1, date: "2026-11-19", weekday, name: null });
    const r = await interpreter.interpret(input({ ...proximaSemana, text: "e na proxima quinta? dia 25 tem?" }));
    assert.deepEqual([r.intent, r.option, r.date], ["choose", 6, "2026-11-25"], String(weekday));
  }
});

test("'Calma, nao eh dia 19 nao. Dia 25!': corrige o dia anterior, vale o 25", async () => {
  const { interpreter } = fakeOllama({ intent: "unclear", option: null, date: null, weekday: null, name: null });
  const r = await interpreter.interpret(input({ ...proximaSemana, text: "Calma, nao eh dia 19 nao. Dia 25!" }));
  assert.deepEqual([r.intent, r.option, r.date], ["choose", 6, "2026-11-25"]);
});
