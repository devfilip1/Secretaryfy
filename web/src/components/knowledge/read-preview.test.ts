import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readLine } from "./read-preview";

const NOTE = "(valor final definido na avaliação)";

describe("readLine", () => {
  it("adds the assessment note when the price is a range", () => {
    assert.equal(
      readLine({ label: "Preço", value: "R$ 500 a R$ 900", assessment: true }, NOTE),
      "Preço: R$ 500 a R$ 900 (valor final definido na avaliação)",
    );
  });

  it("leaves the note out when the switch is off or missing", () => {
    assert.equal(readLine({ label: "Preço", value: "R$ 500", assessment: false }, NOTE), "Preço: R$ 500");
    assert.equal(readLine({ label: "Preço", value: "R$ 500" }, NOTE), "Preço: R$ 500");
  });

  it("returns null without a value, even with the switch on", () => {
    assert.equal(readLine({ label: "Preço", value: "  ", assessment: true }, NOTE), null);
  });

  it("trims the parts and drops the label prefix when it is empty", () => {
    assert.equal(readLine({ label: " ", value: " 30 min ", assessment: true }, NOTE), "30 min (valor final definido na avaliação)");
  });
});
