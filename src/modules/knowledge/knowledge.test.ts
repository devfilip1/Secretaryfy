import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseBrochure } from "./import-markdown.js";
import { toDocument, toSections } from "./render.js";

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

for (const file of ["sorrisopleno.md", "dentalsafe.md"]) {
  test(`${file}: importing and rendering gives back the same titles and lines`, () => {
    const markdown = source(file);
    assert.deepEqual(toSections(parseBrochure(markdown)), plainSections(markdown));
  });

  test(`${file}: 8 treatments and 3 info sections`, () => {
    const rows = parseBrochure(source(file));
    assert.equal(rows.filter((row) => row.kind === "treatment").length, 8);
    assert.equal(rows.filter((row) => row.kind === "info").length, 3);
  });
}

test("the version changes when any field of the brochure changes", () => {
  const before = toDocument("Clínica", parseBrochure(SAMPLE)).version;
  const after = toDocument("Clínica", parseBrochure(SAMPLE.replace("Até 8 tons", "Até 9 tons"))).version;
  assert.notEqual(before, after);
});

test("the version is stable when nothing changes, and the name is part of it", () => {
  const rows = parseBrochure(SAMPLE);
  assert.equal(toDocument("Clínica", rows).version, toDocument("Clínica", parseBrochure(SAMPLE)).version);
  assert.match(toDocument("Clínica", rows).version, /^[0-9a-f]{64}$/);
  assert.notEqual(toDocument("Clínica", rows).version, toDocument("Outra", rows).version);
});

test("sections come out in position order, whatever the order of the rows", () => {
  const rows = parseBrochure(SAMPLE);
  assert.deepEqual(toSections([...rows].reverse()), toSections(rows));
  assert.deepEqual(
    toSections(rows).map((section) => section.title),
    ["Clareamento Dental — Dentes Mais Brancos", "Sobre nós"],
  );
});

test("a section that cannot be parsed is stored as info, with its lines", () => {
  const rows = parseBrochure("## Canal — Dor\nDuração: 1 a 3 sessões\nAlívio já na primeira sessão\n");
  assert.equal(rows[0].kind, "info");
  assert.deepEqual(toSections(rows), [
    { title: "Canal — Dor", body: ["Duração: 1 a 3 sessões", "Alívio já na primeira sessão"] },
  ]);
});

test("text before the first section is refused, not lost", () => {
  assert.throws(() => parseBrochure("Texto solto\n## Seção\nLinha\n"));
});
