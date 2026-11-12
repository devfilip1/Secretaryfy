import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FieldErrors } from "react-hook-form";
import {
  clinicSettingsDefaults,
  clinicSettingsSchema,
  toClinicSettingsInput,
  translateErrors,
  type ClinicSettingsFormValues,
} from "./clinic-settings-form";

const VALID: ClinicSettingsFormValues = {
  name: "Sorriso Pleno",
  assistantName: "Ana",
  kind: "clínica odontológica",
  language: "pt",
  offerAssessment: true,
  assessmentMinutes: "",
  offerFollowUp: false,
  followUpMinutes: "",
};

const withMinutes = (assessmentMinutes: string, followUpMinutes = "") => ({ ...VALID, assessmentMinutes, followUpMinutes });

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

  it("aceita duração vazia, que quer dizer o padrão da agenda", () => {
    assert.equal(clinicSettingsSchema.safeParse(withMinutes("")).success, true);
  });

  it("aceita duração de 15 a 240 minutos, de 5 em 5", () => {
    for (const minutes of ["15", "45", "240"]) {
      assert.equal(clinicSettingsSchema.safeParse(withMinutes(minutes, minutes)).success, true, minutes);
    }
  });

  it("recusa duração fora da faixa, fora do passo de 5 ou que não é número inteiro", () => {
    for (const minutes of ["10", "14", "17", "245", "300", "45.5", "abc", "-15"]) {
      assert.equal(clinicSettingsSchema.safeParse(withMinutes(minutes)).success, false, minutes);
      assert.equal(clinicSettingsSchema.safeParse(withMinutes("", minutes)).success, false, minutes);
    }
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
      offerAssessment: true,
      offerFollowUp: false,
      assessmentMinutes: null,
      followUpMinutes: 60,
    });
    assert.equal(defaults.language, "en");
    assert.equal(defaults.assistantName, "");
    assert.equal(defaults.offerAssessment, true);
    assert.equal(defaults.assessmentMinutes, "");
    assert.equal(defaults.followUpMinutes, "60");
  });
});

describe("toClinicSettingsInput", () => {
  it("manda duração vazia como null e duração preenchida como número", () => {
    const input = toClinicSettingsInput({ ...withMinutes("", "45"), offerFollowUp: true });
    assert.equal(input.assessmentMinutes, null);
    assert.equal(input.followUpMinutes, 45);
    assert.equal(input.offerFollowUp, true);
    assert.equal(input.offerAssessment, true);
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
