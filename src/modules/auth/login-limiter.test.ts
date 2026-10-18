import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoginLimiter } from "./login-limiter.js";

test("5 falhas bloqueiam a 6ª tentativa até a janela passar", () => {
  let now = 0;
  const limiter = createLoginLimiter({ now: () => now });
  for (let i = 0; i < 5; i++) {
    assert.equal(limiter.check("1.1.1.1").allowed, true);
    limiter.fail("1.1.1.1");
  }
  const blocked = limiter.check("1.1.1.1");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterS, 15 * 60);

  now = 10 * 60_000;
  assert.equal(limiter.check("1.1.1.1").retryAfterS, 5 * 60);
  assert.equal(limiter.check("2.2.2.2").allowed, true);

  now = 15 * 60_000;
  assert.equal(limiter.check("1.1.1.1").allowed, true);
});

test("um sucesso zera as falhas do IP", () => {
  const limiter = createLoginLimiter();
  for (let i = 0; i < 4; i++) limiter.fail("1.1.1.1");
  limiter.succeed("1.1.1.1");
  for (let i = 0; i < 4; i++) limiter.fail("1.1.1.1");
  assert.equal(limiter.check("1.1.1.1").allowed, true);
});
