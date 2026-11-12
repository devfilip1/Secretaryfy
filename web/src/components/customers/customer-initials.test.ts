import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialsOf } from "./customer-initials";

describe("initialsOf", () => {
  it("usa a primeira letra do primeiro e do último nome", () => {
    assert.equal(initialsOf("Ana Paula Souza"), "AS");
  });

  it("usa só a primeira letra quando há um nome", () => {
    assert.equal(initialsOf("maria"), "M");
  });

  it("devolve vazio para nome em branco", () => {
    assert.equal(initialsOf("   "), "");
  });
});
