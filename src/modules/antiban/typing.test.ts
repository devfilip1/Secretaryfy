import assert from "node:assert/strict";
import { test } from "node:test";
import { TEST_ANTIBAN as CONFIG } from "../../test/antiban.js";
import { gapDelay, readDelay, thinkDelay, typingDelay } from "./typing.js";

test("digitação fica sempre entre o mínimo e o máximo", () => {
  for (const text of ["ok", "a".repeat(80), "a".repeat(5000)]) {
    for (const r of [0, 0.5, 0.999]) {
      const ms = typingDelay(text, CONFIG, () => r);
      assert.ok(ms >= CONFIG.typingMinMs && ms <= CONFIG.typingMaxMs, `${text.length} chars, random ${r}: ${ms}`);
    }
  }
});

test("texto mais longo digita por mais tempo, em média", () => {
  const avg = (text: string) => {
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += typingDelay(text, CONFIG);
    return sum / 100;
  };
  assert.ok(avg("a".repeat(150)) > avg("a".repeat(20)));
});

test("dois textos do mesmo tamanho não esperam exatamente o mesmo tempo", () => {
  const text = "a".repeat(60);
  assert.notEqual(typingDelay(text, CONFIG, () => 0.1), typingDelay(text, CONFIG, () => 0.7));
});

test("intervalo entre envios fica entre o mínimo e o máximo", () => {
  assert.equal(gapDelay(CONFIG, () => 0), CONFIG.gapMinMs);
  assert.equal(gapDelay(CONFIG, () => 1), CONFIG.gapMaxMs);
  const mid = gapDelay(CONFIG, () => 0.5);
  assert.ok(mid > CONFIG.gapMinMs && mid < CONFIG.gapMaxMs);
});

test("visualizar: entre o mínimo e o máximo, puxando para o meio (FR-005a)", () => {
  assert.equal(readDelay(CONFIG, () => 0), CONFIG.readMinMs);
  assert.equal(readDelay(CONFIG, () => 1), CONFIG.readMaxMs);
  const values = Array.from({ length: 200 }, () => readDelay(CONFIG));
  assert.ok(values.every((v) => v >= CONFIG.readMinMs && v <= CONFIG.readMaxMs));
  assert.ok(new Set(values).size > 1, "o tempo até visualizar não pode ser fixo");
});

test("pausa antes de digitar: cresce com a mensagem do cliente e varia (FR-005b)", () => {
  for (const text of ["oi", "a".repeat(300)]) {
    for (const r of [0, 0.5, 1]) {
      const ms = thinkDelay(text, CONFIG, () => r);
      assert.ok(ms >= CONFIG.thinkMinMs && ms <= CONFIG.thinkMaxMs, `${text.length} chars: ${ms}`);
    }
  }
  assert.ok(thinkDelay("a".repeat(60), CONFIG, () => 0.5) > thinkDelay("oi", CONFIG, () => 0.5));
  assert.notEqual(thinkDelay("a".repeat(40), CONFIG, () => 0.1), thinkDelay("a".repeat(40), CONFIG, () => 0.9));
});
