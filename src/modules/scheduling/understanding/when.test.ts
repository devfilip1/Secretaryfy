import assert from "node:assert/strict";
import { test } from "node:test";
import { createWhenExtractor } from "./when.js";

/** Ollama falso que devolve `reply` (ou falha, se for uma função que lança). */
function fakeOllama(reply: unknown | (() => never)) {
  return {
    chat: async () => {
      if (typeof reply === "function") (reply as () => never)();
      return reply;
    },
  };
}

const noDay = { day_quote: null };

test("horário com a citação na mensagem vira o horário, sem parte do dia", async () => {
  const when = createWhenExtractor({ ollama: fakeOllama({ period_quote: null, period: null, hour_quote: "às 14h", time: "14:00", ...noDay }) });
  assert.deepEqual(await when({ text: "quero marcar às 14h" }), { time: "14:00", period: null, namesDay: false });
});

test("parte do dia com a citação na mensagem vira a parte, sem horário", async () => {
  const when = createWhenExtractor({
    ollama: fakeOllama({ period_quote: "de manhã", period: "morning", hour_quote: null, time: null, ...noDay }),
  });
  assert.deepEqual(await when({ text: "de manhã por favor" }), { time: null, period: "morning", namesDay: false });
});

test("com horário e parte do dia, o horário ganha e a parte some", async () => {
  const when = createWhenExtractor({
    ollama: fakeOllama({ period_quote: "de manhã", period: "morning", hour_quote: "às 9h", time: "09:00", ...noDay }),
  });
  assert.deepEqual(await when({ text: "às 9h de manhã" }), { time: "09:00", period: null, namesDay: false });
});

test("horário sem citação na mensagem é descartado", async () => {
  const when = createWhenExtractor({
    ollama: fakeOllama({ period_quote: null, period: null, hour_quote: "nove horas", time: "09:00", ...noDay }),
  });
  assert.deepEqual(await when({ text: "quero marcar amanhã" }), { time: null, period: null, namesDay: false });
});

test("parte do dia sem citação na mensagem é descartada", async () => {
  const when = createWhenExtractor({
    ollama: fakeOllama({ period_quote: "à tarde", period: "afternoon", hour_quote: null, time: null, ...noDay }),
  });
  assert.deepEqual(await when({ text: "quero marcar" }), { time: null, period: null, namesDay: false });
});

test("horário inválido (25:00 ou 9:00 sem zero) não vira horário", async () => {
  const invalid = createWhenExtractor({ ollama: fakeOllama({ period_quote: null, period: null, hour_quote: "25:00", time: "25:00", ...noDay }) });
  assert.deepEqual(await invalid({ text: "quero marcar 25:00" }), { time: null, period: null, namesDay: false });

  const noZero = createWhenExtractor({ ollama: fakeOllama({ period_quote: null, period: null, hour_quote: "9:00", time: "9:00", ...noDay }) });
  assert.deepEqual(await noZero({ text: "quero marcar 9:00" }), { time: null, period: null, namesDay: false });
});

test("namesDay é verdadeiro só quando a citação do dia está na mensagem", async () => {
  const named = createWhenExtractor({
    ollama: fakeOllama({ period_quote: null, period: null, hour_quote: "às 14h", time: "14:00", day_quote: "amanhã" }),
  });
  assert.equal((await named({ text: "quero marcar amanhã às 14h" })).namesDay, true);

  const notInText = createWhenExtractor({
    ollama: fakeOllama({ period_quote: null, period: null, hour_quote: "às 14h", time: "14:00", day_quote: "sexta" }),
  });
  assert.equal((await notInText({ text: "quero marcar às 14h" })).namesDay, false);
});

test("saída fora do esquema vira nulo nos três campos", async () => {
  const when = createWhenExtractor({ ollama: fakeOllama(null) });
  assert.deepEqual(await when({ text: "quero marcar" }), { time: null, period: null, namesDay: null });
});

test("falha do Ollama vira nulo nos três campos e é registrada", async () => {
  const errors: string[] = [];
  const when = createWhenExtractor({ ollama: fakeOllama(() => { throw new Error("tempo esgotado"); }) });
  const log = { error: (_obj: object, msg: string) => void errors.push(msg) };
  assert.deepEqual(await when({ text: "quero marcar", log }), { time: null, period: null, namesDay: null });
  assert.equal(errors.length, 1);
});
