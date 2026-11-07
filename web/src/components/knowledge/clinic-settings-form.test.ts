import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clinicSettingsSchema } from "./clinic-settings-form";

const VALID = { name: "Sorriso Pleno", assistantName: "Ana", kind: "clínica odontológica" };

describe("clinicSettingsSchema", () => {
  it("aceita nome da assistente vazio, que quer dizer nenhum", () => {
    assert.equal(clinicSettingsSchema.safeParse({ ...VALID, assistantName: "" }).success, true);
  });

  it("exige o nome da clínica e o tipo, sem contar espaços", () => {
    assert.equal(clinicSettingsSchema.safeParse({ ...VALID, name: "   " }).success, false);
    assert.equal(clinicSettingsSchema.safeParse({ ...VALID, kind: "" }).success, false);
  });

  it("recusa o que passa dos limites do servidor", () => {
    assert.equal(clinicSettingsSchema.safeParse({ ...VALID, name: "a".repeat(121) }).success, false);
    assert.equal(clinicSettingsSchema.safeParse({ ...VALID, assistantName: "a".repeat(61) }).success, false);
    assert.equal(clinicSettingsSchema.safeParse({ ...VALID, kind: "a".repeat(81) }).success, false);
  });
});
