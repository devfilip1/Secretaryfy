import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSilent } from "./stream-watchdog";

describe("isSilent", () => {
  it("não está em silêncio logo após a última atividade", () => {
    assert.equal(isSilent(1_000, 1_000, 45_000), false);
  });

  it("no limite exato ainda não está em silêncio", () => {
    assert.equal(isSilent(46_000, 1_000, 45_000), false);
  });

  it("passado o limite está em silêncio", () => {
    assert.equal(isSilent(46_001, 1_000, 45_000), true);
  });
});
