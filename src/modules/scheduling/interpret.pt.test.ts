import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionOption } from "../../db/schema.js";
import { createInterpreter, type InterpretInput } from "./interpret.js";

// Regras sem modelo: o Ollama não é chamado, então um falso que lança basta.
const noModel = { chat: async () => Promise.reject(new Error("não deveria chamar o modelo")) };
const interpreter = createInterpreter({ ollama: noModel, clinicName: "Clínica Sorriso" });

const now = new Date("2026-10-20T18:00:00Z");
const timeZone = "America/Bahia";
const window = { firstDate: "2026-10-20", lastDate: "2026-12-20" };

function input(text: string, overrides: Partial<InterpretInput> = {}): InterpretInput {
  return { text, step: null, options: [], history: [], now, timeZone, window, awaitingName: false, ...overrides };
}

const slotOptions: SessionOption[] = [
  { n: 1, kind: "slot", start: "2026-10-21T12:00:00.000Z" },
  { n: 2, kind: "slot", start: "2026-10-21T13:00:00.000Z" },
];

test("sim, não e nao quero em pt respondem à confirmação", async () => {
  assert.equal((await interpreter.interpret(input("sim", { step: "confirm_booking" }))).intent, "yes");
  assert.equal((await interpreter.interpret(input("claro", { step: "confirm_booking" }))).intent, "yes");
  assert.equal((await interpreter.interpret(input("Com certeza!", { step: "confirm_booking" }))).intent, "yes");
  assert.equal((await interpreter.interpret(input("não", { step: "confirm_booking" }))).intent, "no");
  assert.equal((await interpreter.interpret(input("nao quero", { step: "confirm_booking" }))).intent, "no");
  assert.equal((await interpreter.interpret(input("de jeito nenhum", { step: "confirm_cancel" }))).intent, "no");
});

test("mais, mais horários e outros horários pedem mais horários", async () => {
  for (const text of ["mais", "mais horários", "outros horários"]) {
    assert.equal((await interpreter.interpret(input(text, { step: "choose_slot", options: slotOptions }))).intent, "more", text);
  }
});

test("outro dia e outra data pedem outro dia", async () => {
  for (const text of ["outro dia", "outra data", "outro dia por favor"]) {
    assert.equal((await interpreter.interpret(input(text, { step: "choose_day" }))).intent, "other_day", text);
  }
});

test("agradecimento e despedida em pt", async () => {
  assert.equal((await interpreter.interpret(input("obrigada, tchau"))).intent, "goodbye");
  assert.equal((await interpreter.interpret(input("muito obrigado, até mais"))).intent, "goodbye");
});

test("meu nome é, me chamo e sou o/a dizem o nome", async () => {
  assert.deepEqual(pick(await interpreter.interpret(input("Meu nome é Maria"))), ["give_name", "Maria"]);
  assert.deepEqual(pick(await interpreter.interpret(input("me chamo João"))), ["give_name", "João"]);
  assert.deepEqual(pick(await interpreter.interpret(input("sou a Ana", { step: "ask_name" }))), ["give_name", "Ana"]);
});

test("tratamento citado em pt vira escolha de serviço", async () => {
  assert.deepEqual(pick(await interpreter.interpret(input("limpeza", { step: "choose_service" }))), ["choose_service", "Dental Cleaning"]);
  assert.deepEqual(pick(await interpreter.interpret(input("canal", { step: "choose_service" }))), ["choose_service", "Root Canal Treatment"]);
});

function pick(i: { intent: string; name: string | null; service?: string | null }): [string, string | null | undefined] {
  return [i.intent, i.name ?? i.service];
}

const dayOptions: SessionOption[] = [
  { n: 1, kind: "day", date: "2026-10-21" },
  { n: 2, kind: "day", date: "2026-10-22" },
  { n: 3, kind: "day", date: "2026-10-23" },
  { n: 4, kind: "day", date: "2026-10-26" },
];

test("o cliente escolhe o dia por frase, sem número: dia da semana, dia do mês, primeiro, último", async () => {
  const pickDay = async (text: string) => (await interpreter.interpret(input(text, { step: "choose_day", options: dayOptions }))).option;
  assert.equal(await pickDay("quero sexta"), 3);
  assert.equal(await pickDay("pode ser na quinta-feira"), 2);
  assert.equal(await pickDay("segunda"), 4);
  assert.equal(await pickDay("quero o dia 26"), 4);
  assert.equal(await pickDay("o primeiro"), 1);
  assert.equal(await pickDay("o último"), 4);
});

test("o cliente escolhe o horário por frase: o das 9, às 10h; e pede mais ou outro dia falando", async () => {
  const hours: SessionOption[] = [
    { n: 1, kind: "slot", start: "2026-10-21T12:00:00.000Z" },
    { n: 2, kind: "slot", start: "2026-10-21T13:00:00.000Z" },
  ];
  const ask = (text: string) => interpreter.interpret(input(text, { step: "choose_slot", options: hours }));
  assert.equal((await ask("o das 9")).option, 1);
  assert.equal((await ask("pode ser às 10h")).option, 2);
  assert.equal((await ask("quero ver mais")).intent, "more");
  assert.equal((await ask("quero outro dia")).intent, "other_day");
});
