import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionOption } from "../../db/schema.js";
import { testCatalog } from "../../test/catalog.js";
import { testClinic } from "../../test/clinic.js";
import { createInterpreter, type InterpretInput } from "./interpret.js";
import { createOllamaClient } from "./ollama.js";

/** Ollama falso que devolve `reply` como conteúdo da mensagem (como em interpret.test.ts). */
function fakeOllama(reply: unknown) {
  const fetch = (async () => new Response(JSON.stringify({ message: { role: "assistant", content: JSON.stringify(reply) } }))) as typeof globalThis.fetch;
  return createInterpreter({ clinic: testClinic, catalog: testCatalog, ollama: createOllamaClient({ url: "http://ollama.test", model: "m", timeoutMs: 1000, fetch }) });
}

/** Horários oferecidos na quinta, 19/11/2026 (a tela de horários) */
const slotsOnScreen: SessionOption[] = [
  { n: 1, kind: "slot", start: "2026-11-19T12:00:00.000Z" },
  { n: 2, kind: "slot", start: "2026-11-19T13:00:00.000Z" },
];

function input(overrides: Partial<InterpretInput>): InterpretInput {
  return {
    text: "",
    awaitingName: false,
    step: "choose_slot",
    options: slotsOnScreen,
    history: [],
    // 12/11/2026, 10h em Salvador: a janela de agendamento começa hoje
    now: new Date("2026-11-12T13:00:00Z"),
    timeZone: "America/Bahia",
    window: { firstDate: "2026-11-12", lastDate: "2026-12-12" },
    ...overrides,
  };
}

test("'não é o dia 19, é o dia 25': a data que o modelo deu (25) fica, e a intenção segue 'outro dia'", async () => {
  const interpreter = fakeOllama({ intent: "other_day", option: null, date: "2026-11-25", name: null });
  const i = await interpreter.interpret(input({ text: "Calma, nao eh dia 19 nao. Dia 25!" }));
  assert.equal(i.intent, "other_day");
  assert.equal(i.date, "2026-11-25");
});

test("'outro dia' sem data citada na frase: a data que o modelo inventou some", async () => {
  const interpreter = fakeOllama({ intent: "other_day", option: null, date: "2026-11-25", name: null });
  const i = await interpreter.interpret(input({ text: "tem outro dia?" }));
  assert.equal(i.intent, "other_day");
  assert.equal(i.date, null);
});

test("duas datas citadas com 'outro dia' e data do modelo fora da frase: vale a última citada (a correção)", async () => {
  const interpreter = fakeOllama({ intent: "other_day", option: null, date: null, name: null });
  const i = await interpreter.interpret(input({ text: "não é dia 19, é dia 25" }));
  assert.equal(i.date, "2026-11-25");
});
