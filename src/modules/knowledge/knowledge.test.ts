import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseBrochure } from "./import-markdown.js";
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

for (const file of ["sorrisopleno.md", "dentalsafe.md"]) {
  test(`${file}: importing and rendering gives back the same titles and lines`, () => {
    const markdown = source(file);
    assert.deepEqual(toSections(parseBrochure(markdown), "pt"), plainSections(markdown));
  });

  test(`${file}: 8 treatments and 3 info sections`, () => {
    const rows = parseBrochure(source(file));
    assert.equal(rows.filter((row) => row.kind === "treatment").length, 8);
    assert.equal(rows.filter((row) => row.kind === "info").length, 3);
  });
}

test("the version changes when any field of the brochure changes", () => {
  const before = toDocument("Clínica", parseBrochure(SAMPLE), "pt").version;
  const after = toDocument("Clínica", parseBrochure(SAMPLE.replace("Até 8 tons", "Até 9 tons")), "pt").version;
  assert.notEqual(before, after);
});

test("the version is stable when nothing changes, and the name is part of it", () => {
  const rows = parseBrochure(SAMPLE);
  assert.equal(toDocument("Clínica", rows, "pt").version, toDocument("Clínica", parseBrochure(SAMPLE), "pt").version);
  assert.match(toDocument("Clínica", rows, "pt").version, /^[0-9a-f]{64}$/);
  assert.notEqual(toDocument("Clínica", rows, "pt").version, toDocument("Outra", rows, "pt").version);
});

test("sections come out in position order, whatever the order of the rows", () => {
  const rows = parseBrochure(SAMPLE);
  assert.deepEqual(toSections([...rows].reverse(), "pt"), toSections(rows, "pt"));
  assert.deepEqual(
    toSections(rows, "pt").map((section) => section.title),
    ["Clareamento Dental — Dentes Mais Brancos", "Sobre nós"],
  );
});

test("a section that cannot be parsed is stored as info, with its lines", () => {
  const rows = parseBrochure("## Canal — Dor\nDuração: 1 a 3 sessões\nAlívio já na primeira sessão\n");
  assert.equal(rows[0].kind, "info");
  assert.deepEqual(toSections(rows, "pt"), [
    { title: "Canal — Dor", body: ["Duração: 1 a 3 sessões", "Alívio já na primeira sessão"] },
  ]);
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
  assert.deepEqual(toSections([treatment(facts)], "pt")[0].body, [
    "Duração: 30 min   |   Preço: R$ 40 a R$ 85 (valor final definido na avaliação)   |   Resultado: Imediato",
  ]);
});

test("a fact flagged assessment carries its note in English, before the next fact", () => {
  const facts = [
    { label: "Duration", value: "30 min" },
    { label: "Price", value: "$40-$85", assessment: true },
    { label: "Result", value: "Immediate" },
  ];
  const [line] = toSections([treatment(facts)], "en")[0].body;
  assert.equal(
    line,
    `Duration: 30 min${FACTS_SEPARATOR}Price: $40-$85 (final value set at the assessment)${FACTS_SEPARATOR}Result: Immediate`,
  );
});

test("a fact without the flag, or with it false, renders as it always did in both languages", () => {
  const plain = [{ label: "Preço", value: "R$ 40 a R$ 85" }];
  const off = [{ label: "Preço", value: "R$ 40 a R$ 85", assessment: false }];
  assert.deepEqual(toSections([treatment(plain)], "pt")[0].body, ["Preço: R$ 40 a R$ 85"]);
  assert.deepEqual(toSections([treatment(off)], "en")[0].body, ["Preço: R$ 40 a R$ 85"]);
  assert.deepEqual(toSections([treatment(plain)], "pt"), toSections([treatment(plain)], "en"));
});

test("the version changes when the assessment flag is toggled, and when the clinic language changes", () => {
  const plain = [{ label: "Preço", value: "R$ 40 a R$ 85" }];
  const flagged = [{ label: "Preço", value: "R$ 40 a R$ 85", assessment: true }];
  const version = (facts: Fact[], language: "pt" | "en") => toDocument("Clínica", [treatment(facts)], language).version;
  assert.notEqual(version(plain, "pt"), version(flagged, "pt"));
  assert.notEqual(version(flagged, "pt"), version(flagged, "en"));
  assert.equal(version(plain, "pt"), version(plain, "pt"));
});
