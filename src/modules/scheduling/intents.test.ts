import assert from "node:assert/strict";
import { test } from "node:test";
import { INTENTS } from "./intents.js";

test("INTENTS não tem duplicados", () => {
  assert.equal(new Set(INTENTS).size, INTENTS.length);
});
