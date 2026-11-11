import assert from "node:assert/strict";
import { test } from "node:test";
import { greetingKey } from "./greeting";

test("saudação muda às 12h e às 18h", () => {
  assert.equal(greetingKey(0), "morning");
  assert.equal(greetingKey(11), "morning");
  assert.equal(greetingKey(12), "afternoon");
  assert.equal(greetingKey(17), "afternoon");
  assert.equal(greetingKey(18), "evening");
  assert.equal(greetingKey(23), "evening");
});
