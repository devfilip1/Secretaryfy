import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize, quoted, quotedByCustomer } from "./quote.js";

test("quotedByCustomer aceita só a citação das mensagens do cliente (a conversa e a atual)", () => {
  const history = [
    { role: "user", content: "Quanto custa a limpeza?" },
    { role: "assistant", content: "A extração dentária custa R$ 200." },
  ];
  assert.equal(quotedByCustomer("limpeza", history, "quero marcar"), true);
  assert.equal(quotedByCustomer("quero marcar", history, "quero marcar"), true);
  assert.equal(quotedByCustomer("extração dentária", history, "quero marcar"), false, "o que o assistente disse não prova nada");
  assert.equal(quotedByCustomer(null, history, "limpeza"), false);
  assert.equal(quotedByCustomer("   ", history, "limpeza"), false);
});

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
