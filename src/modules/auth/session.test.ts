import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "../../config/crypto.js";
import { checkPassword, cookieOptions, createSessionToken, verifySessionToken } from "./session.js";

test("checkPassword compara sem vazar o tamanho", () => {
  assert.equal(checkPassword("senha-do-operador", "senha-do-operador"), true);
  assert.equal(checkPassword("senha-do-operadoR", "senha-do-operador"), false);
  assert.equal(checkPassword("curta", "senha-do-operador"), false);
  assert.equal(checkPassword("", "senha-do-operador"), false);
});

test("token de sessão: válido, adulterado, de outro valor e expirado", () => {
  assert.equal(verifySessionToken(createSessionToken()), true);
  const token = createSessionToken();
  assert.equal(verifySessionToken(token.slice(0, -2) + "xx"), false);
  assert.equal(verifySessionToken(sign("outro-usuario")), false);
  assert.equal(verifySessionToken(sign("operator", -1)), false);
  assert.equal(verifySessionToken(undefined), false);
});

test("cookie HttpOnly, SameSite=Strict e Secure só com https", () => {
  assert.equal(cookieOptions("http://localhost:3000").secure, false);
  assert.equal(cookieOptions("https://app.example.com").secure, true);
  assert.equal(cookieOptions("http://x").httpOnly, true);
  assert.equal(cookieOptions("http://x").sameSite, "strict");
});
