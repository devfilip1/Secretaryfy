import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreatmentRow } from "../../api";
import {
  emptyFact,
  infoDefaults,
  infoFormSchema,
  toInfoInput,
  toTreatmentInput,
  treatmentDefaults,
  treatmentFormSchema,
  type TreatmentFormValues,
} from "./form-values";

const LIMPEZA: TreatmentRow = {
  key: "limpeza-dental",
  kind: "treatment",
  title: "Limpeza Dental",
  tagline: "O Primeiro Passo para um Sorriso Saudável",
  position: 0,
  data: {
    ideal: { title: "Ideal para quem quer", items: ["Sensação imediata de boca limpa", "Hálito mais fresco"] },
    howItWorks: { label: "Como funciona", value: "Remoção de placa e tártaro com ultrassom" },
    facts: [
      { label: "Duração", value: "30 a 50 minutos" },
      { label: "Preço", value: "R$ 40 a R$ 85", assessment: true },
    ],
    result: { label: "Resultado", value: "Imediato, já na primeira sessão" },
    recovery: undefined,
  },
};

function values(overrides: Partial<TreatmentFormValues> = {}): TreatmentFormValues {
  const complete = { ...treatmentDefaults(), title: "Limpeza Dental", facts: [{ label: "Duração", value: "30 min", assessment: false }] };
  return { ...complete, ...overrides };
}

describe("texto de linhas (informações)", () => {
  it("separa linhas, tira espaços e descarta linhas vazias", () => {
    const input = toInfoInput({ title: " Endereço ", lines: "  Rua A, 10  \n\n\nAberto das 8h às 18h\n   " });
    assert.equal(input.title, "Endereço");
    assert.equal(input.tagline, null);
    assert.deepEqual(input.data, { lines: ["Rua A, 10", "Aberto das 8h às 18h"] });
  });

  it("volta as linhas da seção para o texto, uma por linha", () => {
    const values = infoDefaults({
      key: "endereco",
      kind: "info",
      title: "Endereço",
      tagline: null,
      position: 1,
      data: { lines: ["Rua A, 10", "Aberto das 8h às 18h"] },
    });
    assert.equal(values.lines, "Rua A, 10\nAberto das 8h às 18h");
  });

  it("aceita a seção de texto só com título e uma linha", () => {
    const parsed = infoFormSchema.safeParse({ title: "Contato", lines: "agendamentos@clinica.example" });
    assert.equal(parsed.success, true);
  });
});

describe("tratamento: conversão para a forma do servidor", () => {
  it("transforma as linhas da lista 'Ideal para' em items, sem linhas vazias", () => {
    const input = toTreatmentInput(
      values({ ideal: { title: "Ideal para quem quer", items: [{ text: " A " }, { text: "" }, { text: "B" }] } }),
    );
    assert.deepEqual(input.data.ideal, { title: "Ideal para quem quer", items: ["A", "B"] });
  });

  it("deixa 'ideal' fora quando o título e as linhas estão vazios", () => {
    const input = toTreatmentInput(values({ ideal: { title: "  ", items: [{ text: "" }] } }));
    assert.equal(input.data.ideal, undefined);
  });

  it("vira tagline null quando o campo está vazio ou só com espaços", () => {
    assert.equal(toTreatmentInput(values({ tagline: "   " })).tagline, null);
    assert.equal(toTreatmentInput(values({ tagline: " Um sorriso " })).tagline, "Um sorriso");
  });

  it("deixa os blocos opcionais vazios como undefined", () => {
    const input = toTreatmentInput(values());
    assert.equal(input.data.howItWorks, undefined);
    assert.equal(input.data.result, undefined);
    assert.equal(input.data.recovery, undefined);
  });

  it("mantém um bloco preenchido só em um campo, para o servidor apontar o que falta", () => {
    const input = toTreatmentInput(values({ result: { label: "Resultado", value: "  " } }));
    assert.deepEqual(input.data.result, { label: "Resultado", value: "" });
  });

  it("marca 'assessment' só nos fatos com a chave ligada", () => {
    const input = toTreatmentInput(
      values({
        facts: [
          { label: "Duração", value: "30 min", assessment: false },
          { label: " Preço ", value: " R$ 40 a R$ 85 ", assessment: true },
        ],
      }),
    );
    assert.deepEqual(input.data.facts, [
      { label: "Duração", value: "30 min" },
      { label: "Preço", value: "R$ 40 a R$ 85", assessment: true },
    ]);
    assert.equal("assessment" in input.data.facts[0], false);
  });
});

describe("tratamento: volta do servidor para os valores do formulário", () => {
  it("leva a seção existente e converte de volta para o mesmo dado", () => {
    const back = toTreatmentInput(treatmentDefaults(LIMPEZA));
    assert.equal(back.title, LIMPEZA.title);
    assert.equal(back.tagline, LIMPEZA.tagline);
    assert.deepEqual(back.data, {
      ideal: LIMPEZA.data.ideal,
      howItWorks: LIMPEZA.data.howItWorks,
      facts: LIMPEZA.data.facts,
      result: LIMPEZA.data.result,
      recovery: undefined,
    });
  });

  it("transforma as items da seção em linhas da lista", () => {
    const defaults = treatmentDefaults(LIMPEZA);
    assert.deepEqual(defaults.ideal.items, [{ text: "Sensação imediata de boca limpa" }, { text: "Hálito mais fresco" }]);
  });

  it("começa com uma linha de fato vazia e sem itens num tratamento novo", () => {
    const defaults = treatmentDefaults();
    assert.deepEqual(defaults.facts, [emptyFact()]);
    assert.deepEqual(defaults.ideal.items, []);
    assert.equal(defaults.tagline, "");
  });

  it("guarda o fato com faixa de preço ao abrir a seção", () => {
    const defaults = treatmentDefaults(LIMPEZA);
    assert.equal(defaults.facts[1].assessment, true);
    assert.equal(defaults.facts[0].assessment, false);
  });
});

describe("tratamento: schema do formulário", () => {
  it("exige pelo menos um fato", () => {
    const parsed = treatmentFormSchema.safeParse(values({ facts: [] }));
    assert.equal(parsed.success, false);
  });

  it("aceita um tratamento completo", () => {
    const parsed = treatmentFormSchema.safeParse(values());
    assert.equal(parsed.success, true);
  });
});
