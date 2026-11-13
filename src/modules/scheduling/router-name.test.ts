import assert from "node:assert/strict";
import { test } from "node:test";
import { setup, MESSAGE, SESSION } from "../../test/router-harness.js";
import { testReplies as replies } from "../../test/clinic.js";

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
    setup({ intent: "question", customerName: null, nameAskedAt: new Date("2026-10-20T10:00:00Z"), messagesSinceAsk: 3, nameAsks: 2 }),
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

test("o pedido de nome volta uma vez, depois de algumas mensagens sem dizer; depois não", async () => {
  const asked = new Date("2026-10-20T10:00:00Z");
  const again = setup({ intent: "question", customerName: null, nameAsks: 1, nameAskedAt: asked, messagesSinceAsk: 3 });
  assert.ok((await again.reply())?.followUp);
  assert.equal(again.askedAt.length, 1);
  const enough = setup({ intent: "question", customerName: null, nameAsks: 2, nameAskedAt: asked, messagesSinceAsk: 9 });
  assert.equal((await enough.reply())?.followUp, undefined);
  assert.equal(enough.askedAt.length, 0);
});

// --- Nome dito em resposta ao pedido, com os horários do dia na tela ---

const asked = new Date("2026-11-19T10:00:00Z");
const onScreen = { ...SESSION, step: "choose_slot", options: [{ n: 1, kind: "slot", start: "2026-11-19T13:00:00Z" }] } as typeof SESSION;

test("o nome dito depois do pedido, com horários na tela: grava o nome e a pergunta da etapa volta, sem reler a lista", async () => {
  // O modelo leu "Sou Joao" como "outro dia": o nome é o que vale
  const r = setup({ intent: "other_day", name: "Joao", session: onScreen, customerName: null, nameAskedAt: asked, messagesSinceAsk: 1 });
  const reply = await r.reply();
  assert.equal(reply?.text, `${replies.nameKept("Joao")}\n\ntela pendente`);
  assert.deepEqual(r.savedNames, ["Joao"]);
  assert.deepEqual(r.resumed.map((x) => x.knownName), ["Joao"]);
  assert.equal(r.handled.length, 0);
});

test("a mensagem que não diz nome segue o caminho normal, sem gravar nada", async () => {
  const r = setup({ intent: "other_day", name: null, session: onScreen, customerName: null, nameAskedAt: asked, messagesSinceAsk: 1 });
  await r.reply();
  assert.equal(r.resumed.length, 0);
  assert.equal(r.handled.length, 1);
  assert.deepEqual(r.savedNames, []);
});

test("nome junto de um horário ou de uma parada: não é só o nome, segue o caminho normal", async () => {
  for (const extra of [{ intent: "choose" as const, time: "10:00" }, { intent: "stop" as const, name: "Joao" }]) {
    const r = setup({ name: "Joao", session: onScreen, customerName: null, nameAskedAt: asked, messagesSinceAsk: 1, ...extra });
    await r.reply();
    assert.equal(r.resumed.length, 0, extra.intent);
    assert.equal(r.handled.length, 1, extra.intent);
  }
});

test("mensagens do debounce desde a nossa resposta saem do histórico e contam para o nome", async () => {
  const r = setup({
    intent: "question",
    customerName: null,
    nameAskedAt: new Date("2026-10-20T10:00:00Z"),
    messagesSinceAsk: 2,
    history: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "Carla" },
      { role: "user", content: MESSAGE.text! },
    ],
  });
  await r.reply();
  assert.equal(r.inputs[0].awaitingName, true);
  assert.deepEqual(r.inputs[0].history.map((m) => m.content), ["hi", "Hello!"]);
});

test("o folheto vê a nossa saudação só como \"Bom dia!\", sem o nome, para não repeti-la nem cumprimentar de novo", async () => {
  const r = setup({
    intent: "question",
    history: [
      { role: "user", content: "hi" },
      { role: "assistant", content: replies.greeting(10) },
    ],
  });
  await r.reply();
  assert.deepEqual(r.histories[0], [{ role: "user", content: "hi" }, { role: "assistant", content: replies.salutation(10) }]);
});
