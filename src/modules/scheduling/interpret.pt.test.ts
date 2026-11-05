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

/** Interpretador com um modelo que devolve sempre a saída dada (o que o qwen devolveria para a frase). */
const asking = (raw: object) =>
  createInterpreter({ ollama: { chat: async () => ({ option: null, date: null, weekday: null, name: null, ...raw }) } as never });

test("o modelo devolve o dia da semana pelo nome em inglês e o código faz a conta do calendário", async () => {
  // Terça, 20/10/2026: o próximo sábado é 24/10; 'domingo' em plural, abreviado ou com erro de digitação é problema do modelo, não de lista de palavras
  const r = await asking({ intent: "availability", weekday: "saturday" }).interpret(input("vocês atendem aos sábados?"));
  assert.equal(r.intent, "availability");
  assert.equal(r.date, "2026-10-24");
  // Se o dia da semana é hoje, conta hoje
  const today = await asking({ intent: "availability", weekday: "tuesday" }).interpret(input("tem horário na terça?"));
  assert.equal(today.date, "2026-10-20");
});

test("na lista de dias, o dia da semana citado vira a opção oferecida; fora da lista, vira a data", async () => {
  const inList = await asking({ intent: "choose", weekday: "friday" }).interpret(input("pode ser sexta", { step: "choose_day", options: dayOptions }));
  assert.equal(inList.option, 3);
  const outside = await asking({ intent: "choose", weekday: "sunday" }).interpret(input("e domingo?", { step: "choose_day", options: dayOptions }));
  assert.equal(outside.option, null);
  assert.equal(outside.date, "2026-10-25");
});

test("saudação e 'qual seu nome?' vêm do modelo como intenções; pergunta nunca vira nome", async () => {
  assert.equal((await asking({ intent: "greeting" }).interpret(input("oi, bom dia!"))).intent, "greeting");
  assert.equal((await asking({ intent: "who_are_you" }).interpret(input("qual seu nome?"))).intent, "who_are_you");
  // O modelo se confunde com a palavra "nome" e devolve o nome: a interrogação derruba
  const confused = await asking({ intent: "give_name", name: "Qual Seu Nome" }).interpret(input("Qual seu nome?"));
  assert.equal(confused.intent, "unclear");
});
