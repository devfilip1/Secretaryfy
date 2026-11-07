import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CLINIC_HOURS } from "../../test/hours.js";
import type { Language } from "../scheduling/dates.js";
import { hoursLines } from "./hours.js";
import { importBrochure, parseBrochure } from "./import-markdown.js";
import { FACTS_SEPARATOR, toDocument, toSections } from "./render.js";
import { knowledgeRowSchema, type Fact, type KnowledgeRow } from "./types.js";

const source = (file: string) => readFileSync(new URL(`../../../rag/data/source/${file}`, import.meta.url), "utf8");

/** O que o arquivo diz, sem interpretar: cada "## " abre uma seção; as linhas não vazias são o corpo. */
function plainSections(markdown: string): { title: string; body: string[] }[] {
  const sections: { title: string; body: string[] }[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("## ")) sections.push({ title: line.slice(3).trim(), body: [] });
    else if (line) sections.at(-1)!.body.push(line);
  }
  return sections;
}

/** Seções renderizadas com o horário das regras de atendimento (o horário de CLINIC_HOURS). */
const sectionsOf = (rows: KnowledgeRow[], language: Language = "pt") => toSections(rows, language, hoursLines(CLINIC_HOURS, language));

const SAMPLE = [
  "## Clareamento Dental — Dentes Mais Brancos",
  "Ideal para quem quer:",
  "- Melhorar a aparência",
  "Como funciona: Gel clareador.",
  "Duração: No consultório   |   Preço: R$ 180",
  "Resultado: Até 8 tons",
  "",
  "## Sobre nós",
  "Linha um",
  "Linha dois",
  "",
].join("\n");

/** Um tratamento com só os fatos dados (a flag `assessment` não vem da brochura, vem do painel). */
const treatment = (facts: Fact[]): KnowledgeRow =>
  knowledgeRowSchema.parse({ key: "limpeza", kind: "treatment", title: "Limpeza", tagline: null, data: { facts }, position: 0 });

const CLINIC_BLOCK = [
  "## Clínica Teste — Informações",
  "Bem-vinda",
  "ENDEREÇO",
  "Rua A, 1",
  "Bairro B",
  "HORÁRIO",
  "Segunda a sexta: 9h às 18h",
  "Sábado: 9h às 14h",
  "Domingo: Fechado",
  "CONTATO",
  "(21) 5555-0148",
  "agenda@teste.example",
  "Um texto final",
  "",
].join("\n");

for (const [file, language] of [
  ["sorrisopleno.md", "pt"],
  ["dentalsafe.md", "en"],
] as const) {
  test(`${file}: importing and rendering gives back the same titles and lines`, () => {
    const markdown = source(file);
    // O importador liga o aviso de avaliação no preço; o texto original não o tem
    const withoutNotes = parseBrochure(markdown).map((row) =>
      row.kind === "treatment" ? { ...row, data: { ...row.data, facts: row.data.facts.map(({ label, value }) => ({ label, value })) } } : row,
    );
    assert.deepEqual(sectionsOf(withoutNotes, language), plainSections(markdown));
  });

  test(`${file}: 8 treatments, one clinic section and 2 info sections`, () => {
    const rows = parseBrochure(source(file));
    assert.equal(rows.filter((row) => row.kind === "treatment").length, 8);
    assert.equal(rows.filter((row) => row.kind === "clinic").length, 1);
    assert.equal(rows.filter((row) => row.kind === "info").length, 2);
  });
}

test("the clinic section of the Portuguese brochure: intro, address, contact and closing, with no hours stored", () => {
  const [clinic] = parseBrochure(source("sorrisopleno.md")).filter((row) => row.kind === "clinic");
  assert.deepEqual(clinic.kind === "clinic" && clinic.data.address, ["Avenida Atlântica, 125, Sala 204", "Rio de Janeiro, RJ, 22010-000, Brasil"]);
  assert.equal(clinic.kind === "clinic" && clinic.data.phone, "(21) 5555-0148");
  assert.equal(clinic.kind === "clinic" && clinic.data.email, "agendamentos@sorrisopleno.example");
  assert.equal(clinic.kind === "clinic" && clinic.data.closing.length, 3);
  assert.equal(clinic.kind === "clinic" && "hours" in clinic.data, false);
});

test("the rendered clinic section, in Portuguese, with the hours from the rules", () => {
  const rows = parseBrochure(CLINIC_BLOCK);
  assert.equal(rows[0].kind, "clinic");
  assert.deepEqual(sectionsOf(rows, "pt"), [
    {
      title: "Clínica Teste — Informações",
      body: [
        "Bem-vinda",
        "ENDEREÇO",
        "Rua A, 1",
        "Bairro B",
        "HORÁRIO",
        "Segunda a sexta: 9h às 18h",
        "Sábado: 9h às 14h",
        "Domingo: Fechado",
        "CONTATO",
        "(21) 5555-0148",
        "agenda@teste.example",
        "Um texto final",
      ],
    },
  ]);
});

test("the rendered clinic section, in English, uses the English headings and time format", () => {
  const body = sectionsOf(parseBrochure(CLINIC_BLOCK), "en")[0].body;
  assert.deepEqual(body.slice(0, 4), ["Bem-vinda", "LOCATION", "Rua A, 1", "Bairro B"]);
  assert.ok(body.includes("HOURS"));
  assert.ok(body.includes("Monday–Friday: 9:00 AM–6:00 PM"));
  assert.ok(body.includes("CONTACT"));
});

test("import: the hours lines are dropped and returned, so the owner can check them against the rules", () => {
  const { rows, droppedHours } = importBrochure(CLINIC_BLOCK);
  assert.equal(rows[0].kind, "clinic");
  assert.deepEqual(droppedHours, ["Segunda a sexta: 9h às 18h", "Sábado: 9h às 14h", "Domingo: Fechado"]);
});

test("import: an email alone in the contact block is the email, with no phone", () => {
  const rows = parseBrochure("## Clínica — Info\nENDEREÇO\nRua A\nHORÁRIO\nSábado: 9h às 14h\nCONTATO\nagenda@teste.example\n");
  assert.equal(rows[0].kind, "clinic");
  assert.deepEqual(rows[0].kind === "clinic" && rows[0].data, { intro: [], address: ["Rua A"], email: "agenda@teste.example", closing: [] });
});

test("import: a section with only some of the three headings, or an email before the closing text, stays info", () => {
  const missingContact = "## Clínica — Info\nENDEREÇO\nRua A\nHORÁRIO\nSábado: 9h às 14h\n";
  const emailInClosing = "## Clínica — Info\nENDEREÇO\nRua A\nHORÁRIO\nSábado: 9h às 14h\nCONTATO\nTexto\nagenda@teste.example\n";
  assert.equal(parseBrochure(missingContact)[0].kind, "info");
  assert.equal(parseBrochure(emailInClosing)[0].kind, "info");
});

test("the version changes when the hours change, since the hours are part of the document", () => {
  const rows = parseBrochure(CLINIC_BLOCK);
  const other = { ...CLINIC_HOURS, "6": { start: "09:00", end: "12:00" } };
  assert.notEqual(
    toDocument("Clínica", rows, "pt", hoursLines(CLINIC_HOURS, "pt")).version,
    toDocument("Clínica", rows, "pt", hoursLines(other, "pt")).version,
  );
});

test("the version changes when any field of the brochure changes", () => {
  const before = toDocument("Clínica", parseBrochure(SAMPLE), "pt", hoursLines(CLINIC_HOURS, "pt")).version;
  const after = toDocument("Clínica", parseBrochure(SAMPLE.replace("Até 8 tons", "Até 9 tons")), "pt", hoursLines(CLINIC_HOURS, "pt")).version;
  assert.notEqual(before, after);
});

test("the version is stable when nothing changes, and the name is part of it", () => {
  const rows = parseBrochure(SAMPLE);
  const hours = hoursLines(CLINIC_HOURS, "pt");
  assert.equal(toDocument("Clínica", rows, "pt", hours).version, toDocument("Clínica", parseBrochure(SAMPLE), "pt", hours).version);
  assert.match(toDocument("Clínica", rows, "pt", hours).version, /^[0-9a-f]{64}$/);
  assert.notEqual(toDocument("Clínica", rows, "pt", hours).version, toDocument("Outra", rows, "pt", hours).version);
});

test("sections come out in position order, whatever the order of the rows", () => {
  const rows = parseBrochure(SAMPLE);
  assert.deepEqual(sectionsOf([...rows].reverse()), sectionsOf(rows));
  assert.deepEqual(
    sectionsOf(rows).map((section) => section.title),
    ["Clareamento Dental — Dentes Mais Brancos", "Sobre nós"],
  );
});

test("a section that cannot be parsed is stored as info, with its lines", () => {
  const rows = parseBrochure("## Canal — Dor\nDuração: 1 a 3 sessões\nAlívio já na primeira sessão\n");
  assert.equal(rows[0].kind, "info");
  assert.deepEqual(sectionsOf(rows), [{ title: "Canal — Dor", body: ["Duração: 1 a 3 sessões", "Alívio já na primeira sessão"] }]);
});

test("text before the first section is refused, not lost", () => {
  assert.throws(() => parseBrochure("Texto solto\n## Seção\nLinha\n"));
});

test("a fact flagged assessment carries its note in Portuguese, inside the same fact", () => {
  const facts = [
    { label: "Duração", value: "30 min" },
    { label: "Preço", value: "R$ 40 a R$ 85", assessment: true },
    { label: "Resultado", value: "Imediato" },
  ];
  assert.deepEqual(sectionsOf([treatment(facts)], "pt")[0].body, [
    "Duração: 30 min   |   Preço: R$ 40 a R$ 85 (valor final definido na avaliação)   |   Resultado: Imediato",
  ]);
});

test("a fact flagged assessment carries its note in English, before the next fact", () => {
  const facts = [
    { label: "Duration", value: "30 min" },
    { label: "Price", value: "$40-$85", assessment: true },
    { label: "Result", value: "Immediate" },
  ];
  const [line] = sectionsOf([treatment(facts)], "en")[0].body;
  assert.equal(
    line,
    `Duration: 30 min${FACTS_SEPARATOR}Price: $40-$85 (final value set at the assessment)${FACTS_SEPARATOR}Result: Immediate`,
  );
});

test("a fact without the flag, or with it false, renders as it always did in both languages", () => {
  const plain = [{ label: "Preço", value: "R$ 40 a R$ 85" }];
  const off = [{ label: "Preço", value: "R$ 40 a R$ 85", assessment: false }];
  assert.deepEqual(sectionsOf([treatment(plain)], "pt")[0].body, ["Preço: R$ 40 a R$ 85"]);
  assert.deepEqual(sectionsOf([treatment(off)], "en")[0].body, ["Preço: R$ 40 a R$ 85"]);
  assert.deepEqual(sectionsOf([treatment(plain)], "pt"), sectionsOf([treatment(plain)], "en"));
});

test("the version changes when the assessment flag is toggled, and when the clinic language changes", () => {
  const plain = [{ label: "Preço", value: "R$ 40 a R$ 85" }];
  const flagged = [{ label: "Preço", value: "R$ 40 a R$ 85", assessment: true }];
  const version = (facts: Fact[], language: Language) =>
    toDocument("Clínica", [treatment(facts)], language, hoursLines(CLINIC_HOURS, language)).version;
  assert.notEqual(version(plain, "pt"), version(flagged, "pt"));
  assert.notEqual(version(flagged, "pt"), version(flagged, "en"));
  assert.equal(version(plain, "pt"), version(plain, "pt"));
});

test("the importer turns the assessment note on for price facts only", () => {
  const treatments = parseBrochure(source("sorrisopleno.md")).filter((row) => row.kind === "treatment");
  for (const row of treatments) {
    for (const fact of row.data.facts) assert.equal(fact.assessment === true, fact.label === "Preço", `${row.title}: ${fact.label}`);
  }
});

test("{clinic_name} in the brochure text becomes the current clinic name, so a rename updates it", () => {
  const rows = parseBrochure(source("sorrisopleno.md")).map((row) =>
    row.kind === "info" ? { ...row, data: { lines: [`Na {clinic_name}, você é bem-vindo.`] } } : row,
  );
  const doc = toDocument("Dentes Felizes", rows, "pt", []);
  assert.ok(doc.sections.some((s) => s.body.includes("Na Dentes Felizes, você é bem-vindo.")));
  assert.ok(!JSON.stringify(doc.sections).includes("{clinic_name}"));
});
