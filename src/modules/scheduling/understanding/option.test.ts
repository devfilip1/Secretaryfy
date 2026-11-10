import assert from "node:assert/strict";
import { test } from "node:test";
import { createOptionExtractor } from "./option.js";

/** Ollama falso que devolve `reply` (ou falha, se for uma função que lança). */
function fakeOllama(reply: unknown | (() => never)) {
  return {
    chat: async () => {
      if (typeof reply === "function") (reply as () => never)();
      return reply;
    },
  };
}

test("escolha pela posição com a citação na mensagem devolve o número", async () => {
  const pick = createOptionExtractor({ ollama: fakeOllama({ quote: "segundo", option: 2 }) });
  assert.equal(await pick({ text: "quero o segundo", count: 3 }), 2);
});

test("número fora de 1..count ou não inteiro vira nulo", async () => {
  const text = "quero o zero";
  assert.equal(await createOptionExtractor({ ollama: fakeOllama({ quote: "zero", option: 0 }) })({ text, count: 3 }), null);
  assert.equal(await createOptionExtractor({ ollama: fakeOllama({ quote: "zero", option: 4 }) })({ text, count: 3 }), null);
  assert.equal(await createOptionExtractor({ ollama: fakeOllama({ quote: "zero", option: 1.5 }) })({ text, count: 3 }), null);
});

test("citação que não está na mensagem vira nulo, e citação vazia também", async () => {
  const notInText = createOptionExtractor({ ollama: fakeOllama({ quote: "primeiro", option: 1 }) });
  assert.equal(await notInText({ text: "quero marcar", count: 3 }), null);

  const empty = createOptionExtractor({ ollama: fakeOllama({ quote: "", option: 1 }) });
  assert.equal(await empty({ text: "quero marcar", count: 3 }), null);
});

test("falha do Ollama vira nulo e é registrada", async () => {
  const errors: string[] = [];
  const pick = createOptionExtractor({ ollama: fakeOllama(() => { throw new Error("tempo esgotado"); }) });
  const log = { error: (_obj: object, msg: string) => void errors.push(msg) };
  assert.equal(await pick({ text: "o primeiro", count: 3, log }), null);
  assert.equal(errors.length, 1);
});
