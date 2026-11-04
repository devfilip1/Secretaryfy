import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSESSMENT, detectService, serviceByNumber, serviceLabel } from "./services.js";

test("reconhece os tratamentos pelas palavras em português", () => {
  assert.equal(detectService(["quero marcar uma limpeza"]), "Dental Cleaning");
  assert.equal(detectService(["quanto custa o clareamento?"]), "Teeth Whitening");
  assert.equal(detectService(["preciso de tratamento de canal"]), "Root Canal Treatment");
  assert.equal(detectService(["quero fazer um implante"]), "Dental Implants");
  assert.equal(detectService(["tenho interesse no aparelho"]), "Braces and Orthodontic Treatment");
  assert.equal(detectService(["vou tirar o siso"]), "Tooth Extraction");
  assert.equal(detectService(["lentes de contato dental"]), "Dental Veneers");
  assert.equal(detectService(["não tenho certeza"]), ASSESSMENT);
});

test("o nome guardado continua em inglês; o rótulo muda com a língua", () => {
  assert.equal(detectService(["limpeza"]), "Dental Cleaning");
  assert.equal(serviceLabel("Dental Cleaning", "pt"), "Limpeza Dental");
  assert.equal(serviceLabel("Dental Cleaning"), "Dental Cleaning");
  assert.equal(serviceLabel(ASSESSMENT, "pt"), "Avaliação geral");
  assert.equal(serviceLabel(ASSESSMENT), "General assessment");
  assert.equal(serviceByNumber(1), "Dental Cleaning");
});
