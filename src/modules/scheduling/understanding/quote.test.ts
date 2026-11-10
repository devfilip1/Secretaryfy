import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize, quoted } from "./quote.js";

test("normalize tira acento, põe caixa baixa e troca pontuação por espaço", () => {
  assert.equal(normalize("Não, Ça?"), "nao ca");
  assert.equal(normalize("  às  14h!! "), "as 14h");
  assert.equal(normalize("sexta/sábado"), "sexta/sabado");
});

test("quoted aceita a citação que está na mensagem, sem acento, caixa ou pontuação", () => {
  assert.equal(quoted("Quero marcar às 14h!", "AS 14H"), true);
  assert.equal(quoted("oi, às 14h.", "às 14h"), true);
});

test("quoted recusa citação ausente, vazia, só com espaços ou nula", () => {
  assert.equal(quoted("quero marcar", "sexta"), false);
  assert.equal(quoted("sim", ""), false);
  assert.equal(quoted("sim", "   "), false);
  assert.equal(quoted("sim", null), false);
});
