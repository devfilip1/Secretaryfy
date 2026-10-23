import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCommand } from "./opt-out.js";

const free = { inSchedulingFlow: false };

test("palavras de saída, com caixa, acento e pontuação variados", () => {
  for (const text of ["STOP", " Parar! ", "não quero mais mensagens", "Sair 🙏", "opt-out"]) {
    assert.equal(matchCommand(text, free), "opt_out", text);
  }
});

test("frases que só contêm a palavra não são pedido de saída", () => {
  for (const text of ["não quero parar o tratamento", "stop by tomorrow?", "pode parar de doer?"]) {
    assert.equal(matchCommand(text, free), null, text);
  }
});

test("cancelar no meio de um agendamento é do agendamento", () => {
  assert.equal(matchCommand("Cancelar", { inSchedulingFlow: true }), null);
  assert.equal(matchCommand("Cancelar", free), "opt_out");
});

test("palavras de volta", () => {
  assert.equal(matchCommand("Start", free), "opt_in");
  assert.equal(matchCommand("quero voltar!", free), "opt_in");
});
