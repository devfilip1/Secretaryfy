import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClinicRow, KnowledgeLabels, TreatmentRow } from "../../api";
import {
  clinicDefaults,
  clinicFormSchema,
  factIssues,
  toClinicInput,
  infoDefaults,
  infoFormSchema,
  toInfoInput,
  toTreatmentInput,
  treatmentDefaults,
  treatmentFormSchema,
  type TreatmentFormValues,
  FILL_DURATION_OR_PRICE,
  REQUIRED,
} from "./form-values";

const LABELS: KnowledgeLabels = {
  ideal: "Ideal para quem quer",
  howItWorks: "Como funciona",
  duration: "Duração",
  price: "Preço",
  result: "Resultado",
  recovery: "Recuperação",
  address: "ENDEREÇO",
  hours: "HORÁRIO",
  contact: "CONTATO",
};

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

// Fatos fora da ordem canônica não voltam iguais: a ordem vira Duração, Preço e depois os outros.
// Este caso usa a ordem canônica, com um fato extra e rótulos próprios.
const CLAREAMENTO: TreatmentRow = {
  key: "clareamento",
  kind: "treatment",
  title: "Clareamento",
  tagline: "Sorriso mais claro",
  position: 1,
  data: {
    ideal: { title: "Ideal para", items: ["Dentes amarelados"] },
    howItWorks: { label: "Modo de fazer", value: "Gel clareador aplicado em consultório" },
    facts: [
      { label: "Duração", value: "60 minutos" },
      { label: "Preço", value: "R$ 900 a R$ 1.200", assessment: true },
      { label: "Mensalidade", value: "R$ 35 a R$ 90" },
    ],
    result: { label: "Resultado", value: "Até 8 tons mais claros" },
    recovery: { label: "Tempo de recuperação", value: "Imediata" },
  },
};

function values(overrides: Partial<TreatmentFormValues> = {}): TreatmentFormValues {
  const complete: TreatmentFormValues = {
    ...treatmentDefaults(LABELS),
    title: "Limpeza Dental",
    duration: { label: "Duração", value: "30 min", assessment: false },
  };
  return { ...complete, ...overrides };
}

const CLINICA: ClinicRow = {
  key: "clinica",
  kind: "clinic",
  title: "Sorriso Pleno - Clinic information",
  tagline: null,
  position: 2,
  data: {
    intro: ["Transforme seu sorriso com segurança e rapidez"],
    address: ["Avenida Atlântica, 125", "Sala 204"],
    phone: "(21) 3000-0000",
    email: "contato@clinica.example",
    closing: ["Agende pelo WhatsApp"],
  },
};

describe("tratamento: outros nomes", () => {
  it("as linhas vazias saem, e sem nomes o campo não vai para o dado salvo", () => {
    const defaults = treatmentDefaults(LABELS);
    assert.equal("otherNames" in toTreatmentInput(defaults).data, false);
    const values = { ...defaults, otherNames: [{ text: " branqueamento " }, { text: "" }] };
    assert.deepEqual((toTreatmentInput(values).data as { otherNames?: string[] }).otherNames, ["branqueamento"]);
  });
});

describe("tratamento: pode marcar pelo WhatsApp (bookable)", () => {
  it("sem 'bookable' na seção, continua sem o campo ao salvar (padrão: pode marcar)", () => {
    const defaults = treatmentDefaults(LABELS, LIMPEZA);
    assert.equal(defaults.bookable, true);
    assert.equal("bookable" in toTreatmentInput(defaults).data, false);
  });

  it("tratamento novo começa com pode marcar e não grava o campo", () => {
    assert.equal(treatmentDefaults(LABELS).bookable, true);
    assert.equal("bookable" in toTreatmentInput(values()).data, false);
  });

  it("bookable true explícito volta ligado e sai sem o campo (mesmo significado)", () => {
    const row: TreatmentRow = { ...LIMPEZA, data: { ...LIMPEZA.data, bookable: true } };
    assert.equal(treatmentDefaults(LABELS, row).bookable, true);
    assert.equal("bookable" in toTreatmentInput(treatmentDefaults(LABELS, row)).data, false);
  });

  it("só informação (bookable false) grava false e volta desligado (round trip)", () => {
    const row: TreatmentRow = { ...LIMPEZA, data: { ...LIMPEZA.data, bookable: false } };
    const defaults = treatmentDefaults(LABELS, row);
    assert.equal(defaults.bookable, false);
    assert.deepEqual(toTreatmentInput(defaults).data, row.data);
  });

  it("tratamento só de informação passa no schema do formulário", () => {
    assert.equal(treatmentFormSchema.safeParse(values({ bookable: false })).success, true);
  });
});

describe("clínica: volta do servidor para os valores e de volta (round trip)", () => {
  it("salva sem editar e recebe o mesmo dado", () => {
    const back = toClinicInput(clinicDefaults(CLINICA));
    assert.equal(back.title, CLINICA.title);
    assert.equal(back.tagline, null);
    assert.deepEqual(JSON.parse(JSON.stringify(back.data)), CLINICA.data);
  });

  it("telefone e e-mail vazios saem do dado salvo, e linhas vazias de endereço somem", () => {
    const row: ClinicRow = { ...CLINICA, data: { intro: [], address: ["Avenida Atlântica, 125"], closing: [] } };
    const defaults = clinicDefaults(row);
    defaults.address.push({ text: "  " });
    assert.deepEqual(JSON.parse(JSON.stringify(toClinicInput(defaults).data)), {
      intro: [],
      address: ["Avenida Atlântica, 125"],
      closing: [],
    });
  });

  it("clínica nova abre com uma linha de endereço e exige pelo menos um endereço", () => {
    const defaults = clinicDefaults();
    assert.deepEqual(defaults.address, [{ text: "" }]);
    const empty = clinicFormSchema.safeParse({ ...defaults, title: "Clínica" });
    assert.equal(empty.success, false);
    const filled = clinicFormSchema.safeParse({ ...defaults, title: "Clínica", address: [{ text: "Rua A, 10" }] });
    assert.equal(filled.success, true);
  });
});

describe("texto de linhas (informações)", () => {
  it("separa linhas, tira espaços e descarta linhas vazias", () => {
    const input = toInfoInput({ title: " Endereço ", lines: "  Rua A, 10  \n\n\nAberto das 8h às 18h\n   " });
    assert.equal(input.title, "Endereço");
    assert.equal(input.tagline, null);
    assert.deepEqual(input.data, { lines: ["Rua A, 10", "Aberto das 8h às 18h"] });
  });

  it("volta as linhas da seção para o texto, uma por linha", () => {
    const back = infoDefaults({
      key: "endereco",
      kind: "info",
      title: "Endereço",
      tagline: null,
      position: 1,
      data: { lines: ["Rua A, 10", "Aberto das 8h às 18h"] },
    });
    assert.equal(back.lines, "Rua A, 10\nAberto das 8h às 18h");
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

  it("deixa 'ideal' fora quando não há linhas, mesmo com o título preenchido", () => {
    const input = toTreatmentInput(values({ ideal: { title: "Ideal para quem quer", items: [{ text: "" }] } }));
    assert.equal(input.data.ideal, undefined);
  });

  it("vira tagline null quando o campo está vazio ou só com espaços", () => {
    assert.equal(toTreatmentInput(values({ tagline: "   " })).tagline, null);
    assert.equal(toTreatmentInput(values({ tagline: " Um sorriso " })).tagline, "Um sorriso");
  });

  it("deixa um bloco sem valor como undefined, mesmo com o rótulo da brochura preenchido", () => {
    const input = toTreatmentInput(values());
    assert.equal(input.data.howItWorks, undefined);
    assert.equal(input.data.result, undefined);
    assert.equal(input.data.recovery, undefined);
  });

  it("mantém um bloco com valor e sem rótulo, para o servidor apontar o que falta", () => {
    const input = toTreatmentInput(values({ result: { label: "", value: "Até 8 tons" } }));
    assert.deepEqual(input.data.result, { label: "", value: "Até 8 tons" });
  });

  it("deixa Duração ou Preço sem valor de fora do salvamento", () => {
    const input = toTreatmentInput(values({ price: { label: "Preço", value: "  ", assessment: true } }));
    assert.deepEqual(input.data.facts, [{ label: "Duração", value: "30 min" }]);
  });

  it("marca 'assessment' só nos fatos com a chave ligada, na ordem Duração, Preço e extras", () => {
    const input = toTreatmentInput(
      values({
        price: { label: " Preço ", value: " R$ 40 a R$ 85 ", assessment: true },
        extras: [{ label: " Mensalidade ", value: "R$ 35", assessment: false }],
      }),
    );
    assert.deepEqual(input.data.facts, [
      { label: "Duração", value: "30 min" },
      { label: "Preço", value: "R$ 40 a R$ 85", assessment: true },
      { label: "Mensalidade", value: "R$ 35" },
    ]);
    assert.equal("assessment" in input.data.facts[0], false);
  });
});

describe("tratamento: volta do servidor para os valores do formulário (round trip)", () => {
  it("salva sem editar e recebe o mesmo dado (Limpeza Dental)", () => {
    const back = toTreatmentInput(treatmentDefaults(LABELS, LIMPEZA));
    assert.equal(back.title, LIMPEZA.title);
    assert.equal(back.tagline, LIMPEZA.tagline);
    assert.deepEqual(back.data, LIMPEZA.data);
  });

  it("preserva fato com assessment true, fato extra e rótulos próprios (Clareamento)", () => {
    const back = toTreatmentInput(treatmentDefaults(LABELS, CLAREAMENTO));
    assert.deepEqual(back.data, CLAREAMENTO.data);
  });

  it("um fato com rótulo diferente do da brochura vai para 'Mais detalhes', com o nome guardado", () => {
    const defaults = treatmentDefaults(LABELS, {
      ...CLAREAMENTO,
      data: { ...CLAREAMENTO.data, facts: [{ label: "Tempo", value: "60 min" }] },
    });
    assert.deepEqual(defaults.duration, { label: "Duração", value: "", assessment: false });
    assert.deepEqual(defaults.extras, [{ label: "Tempo", value: "60 min", assessment: false }]);
  });

  it("transforma os items da seção em linhas da lista", () => {
    const defaults = treatmentDefaults(LABELS, LIMPEZA);
    assert.deepEqual(defaults.ideal.items, [{ text: "Sensação imediata de boca limpa" }, { text: "Hálito mais fresco" }]);
  });

  it("num tratamento novo, pré-preenche os rótulos da brochura e deixa os valores vazios", () => {
    const defaults = treatmentDefaults(LABELS);
    assert.equal(defaults.ideal.title, "Ideal para quem quer");
    assert.equal(defaults.howItWorks.label, "Como funciona");
    assert.equal(defaults.howItWorks.value, "");
    assert.deepEqual(defaults.duration, { label: "Duração", value: "", assessment: false });
    assert.deepEqual(defaults.price, { label: "Preço", value: "", assessment: true }); // o preço costuma ser faixa: o aviso já vem ligado
    assert.deepEqual(defaults.extras, []);
    assert.equal(defaults.tagline, "");
    assert.deepEqual(defaults.ideal.items, []);
  });
});

describe("tratamento: regras dos fatos e schema do formulário", () => {
  it("sem nenhum valor em Duração, Preço ou extras, não salva", () => {
    const parsed = treatmentFormSchema.safeParse(values({ duration: { label: "Duração", value: "", assessment: false } }));
    assert.equal(parsed.success, false);
    assert.deepEqual(factIssues(values({ duration: { label: "Duração", value: "", assessment: false } })), [
      { path: ["duration", "value"], message: FILL_DURATION_OR_PRICE },
    ]);
  });

  it("aceita só Preço preenchido", () => {
    const parsed = treatmentFormSchema.safeParse(
      values({ duration: { label: "Duração", value: "", assessment: false }, price: { label: "Preço", value: "R$ 40", assessment: false } }),
    );
    assert.equal(parsed.success, true);
  });

  it("exige nome em um fato extra que tem valor", () => {
    const issues = factIssues(values({ extras: [{ label: "", value: "R$ 35", assessment: false }] }));
    assert.deepEqual(issues, [{ path: ["extras", 0, "label"], message: REQUIRED }]);
  });

  it("aceita um tratamento completo", () => {
    const parsed = treatmentFormSchema.safeParse(values());
    assert.equal(parsed.success, true);
  });
});

describe("tratamento: tempo na agenda", () => {
  it("vazio não grava nada; um número grava e volta para o formulário", () => {
    const defaults = treatmentDefaults(LABELS);
    assert.equal(defaults.appointmentMinutes, "");
    assert.equal("appointmentMinutes" in toTreatmentInput(defaults).data, false);
    const input = toTreatmentInput({ ...defaults, appointmentMinutes: " 45 " });
    assert.equal((input.data as { appointmentMinutes?: number }).appointmentMinutes, 45);
  });

  it("o schema do formulário recusa o que não é múltiplo de 5 ou não é número", () => {
    const base = { ...treatmentDefaults(LABELS), title: "Limpeza", duration: { label: "Duração", value: "30 min", assessment: false } };
    assert.equal(treatmentFormSchema.safeParse({ ...base, appointmentMinutes: "45" }).success, true);
    assert.equal(treatmentFormSchema.safeParse({ ...base, appointmentMinutes: "47" }).success, false);
    assert.equal(treatmentFormSchema.safeParse({ ...base, appointmentMinutes: "abc" }).success, false);
  });
});
