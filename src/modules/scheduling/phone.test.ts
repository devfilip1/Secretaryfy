import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePhone } from "./phone.js";

test("formatos comuns viram o número do WhatsApp", () => {
  for (const input of ["(71) 99999-9999", "+55 71 99999-9999", "071999999999", "5571999999999", "71 9 9999 9999"]) {
    assert.equal(normalizePhone(input), "5571999999999", input);
  }
  // Fixo (10 dígitos) e número de outro país
  assert.equal(normalizePhone("(71) 3333-4444"), "557133334444");
  // Com 11 dígitos o número é lido como do Brasil (R8), mesmo um dos EUA (+1 e 10 dígitos)
  assert.equal(normalizePhone("+44 7911 123456"), "447911123456");
});

test("curto, longo demais ou sem dígitos: null", () => {
  for (const input of ["", "abc", "99999-9999", "1234567890123456"]) assert.equal(normalizePhone(input), null, input);
});
