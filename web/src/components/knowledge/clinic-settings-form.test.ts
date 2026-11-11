import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FieldErrors } from "react-hook-form";
import { clinicSettingsDefaults, clinicSettingsSchema, translateErrors, type ClinicSettingsFormValues } from "./clinic-settings-form";

const VALID = { name: "Sorriso Pleno", assistantName: "Ana", kind: "clínica odontológica", language: "pt" };

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

  it("aceita a língua en e pt, e recusa outra", () => {
    assert.equal(clinicSettingsSchema.safeParse({ ...VALID, language: "en" }).success, true);
    assert.equal(clinicSettingsSchema.safeParse({ ...VALID, language: "pt" }).success, true);
    assert.equal(clinicSettingsSchema.safeParse({ ...VALID, language: "fr" }).success, false);
  });

  it("devolve o código da mensagem, não o texto em inglês", () => {
    const result = clinicSettingsSchema.safeParse({ ...VALID, name: "   " });
    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.message, "nameRequired");
  });
});

describe("clinicSettingsDefaults", () => {
  it("leva a língua da configuração para os valores iniciais", () => {
    const defaults = clinicSettingsDefaults({
      name: "Sorriso Pleno",
      assistantName: null,
      kind: "clínica odontológica",
      language: "en",
      restartRequired: false,
    });
    assert.equal(defaults.language, "en");
    assert.equal(defaults.assistantName, "");
  });
});

describe("translateErrors", () => {
  it("troca o código de cada erro pelo texto e deixa o campo sem erro igual", () => {
    const errors = { name: { type: "too_small", message: "nameRequired" } } as unknown as FieldErrors<ClinicSettingsFormValues>;
    const translated = translateErrors(errors, (code) => `texto:${code}`);
    assert.equal(translated.name?.message, "texto:nameRequired");
    assert.deepEqual(translateErrors({}, (code) => code), {});
  });
});
