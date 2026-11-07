import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { testCatalog } from "../../test/catalog.js";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import { isBookable, type KnowledgeRow } from "../knowledge/types.js";
import { ASSESSMENT, createKnowledgeCatalog } from "./catalog.js";

const { list, byNumber, label, byLabel, panelList } = testCatalog;

const treatment = (key: string, title: string, position: number, data: Record<string, unknown> = {}): KnowledgeRow =>
  ({ key, kind: "treatment", title, tagline: null, position, data: { facts: [{ label: "Preço", value: "R$ 40" }], ...data } }) as KnowledgeRow;
const info = (key: string, position: number): KnowledgeRow => ({ key, kind: "info", title: "Sobre nós", tagline: null, position, data: { lines: ["Linha"] } }) as KnowledgeRow;

/** Repositório falso cujas linhas o teste troca: o catálogo só vê uma mudança no refresh. */
function fakeRepo(rows: KnowledgeRow[]): Pick<KnowledgeRepository, "list"> & { rows: KnowledgeRow[] } {
  const repo = { rows, list: async () => repo.rows };
  return repo;
}

test("a lista é dos tratamentos da tabela que podem ser marcados, na posição, com a avaliação no fim", async () => {
  const repo = fakeRepo([
    treatment("limpeza-dental", "Limpeza Dental", 0),
    info("sobre-nos", 1),
    treatment("clareamento", "Clareamento", 2),
    treatment("siso", "Extração do siso", 3, { bookable: false }),
    treatment("implante", "Implante", 4),
  ]);
  const catalog = createKnowledgeCatalog({ repo });
  await catalog.refresh();
  assert.deepEqual(
    catalog.list().map((s) => s.name),
    ["limpeza-dental", "clareamento", "implante", ASSESSMENT],
  );
  assert.equal(catalog.byNumber(2), "clareamento");
  assert.equal(catalog.byNumber(4), ASSESSMENT);
  assert.equal(catalog.byNumber(5), null);
  assert.equal(catalog.byNumber(0), null);
});

test("bookable: false é só informação; ausente ou true pode marcar; seções que não são tratamento nunca", () => {
  assert.equal(isBookable(treatment("a", "A", 0)), true);
  assert.equal(isBookable(treatment("a", "A", 0, { bookable: true })), true);
  assert.equal(isBookable(treatment("a", "A", 0, { bookable: false })), false);
  assert.equal(isBookable(info("sobre", 0)), false);
});

test("byLabel: o rótulo ou o nome, sem acento nem caixa; sem busca aproximada", async () => {
  const repo = fakeRepo([treatment("limpeza-dental", "Limpeza Dental", 0)]);
  const catalog = createKnowledgeCatalog({ repo });
  await catalog.refresh();
  assert.equal(catalog.byLabel("LIMPEZA dental"), "limpeza-dental");
  assert.equal(catalog.byLabel("limpeza-dental"), "limpeza-dental");
  assert.equal(catalog.byLabel("limpeza"), null);
  assert.equal(catalog.byLabel("avaliacao geral"), ASSESSMENT);
  assert.equal(catalog.byLabel("Avaliação geral"), ASSESSMENT);
  assert.equal(catalog.byLabel("General Assessment"), ASSESSMENT);
});

test("o rótulo da avaliação geral vem da língua pedida; um nome que não está no catálogo volta igual", () => {
  assert.equal(label(ASSESSMENT, "pt"), "Avaliação geral");
  assert.equal(label(ASSESSMENT, "en"), "General assessment");
  assert.equal(label(ASSESSMENT), "General assessment");
  assert.equal(label("Dental Cleaning", "pt"), "Dental Cleaning");
  assert.equal(label("nome-que-nao-existe"), "nome-que-nao-existe");
});

test("refresh segue a tabela: antes dele, o catálogo só tem a avaliação geral", async () => {
  const repo = fakeRepo([]);
  const catalog = createKnowledgeCatalog({ repo });
  assert.deepEqual(catalog.list().map((s) => s.name), [ASSESSMENT]);
  repo.rows = [treatment("clareamento", "Clareamento", 0)];
  assert.deepEqual(catalog.list().map((s) => s.name), [ASSESSMENT]);
  await catalog.refresh();
  assert.deepEqual(catalog.list().map((s) => s.name), ["clareamento", ASSESSMENT]);
  assert.deepEqual(catalog.panelList(), [
    { name: "clareamento", label: "Clareamento" },
    { name: ASSESSMENT, label: "General assessment" },
  ]);
});

test("catálogo dos testes: nove serviços, o nome igual ao rótulo e a avaliação no fim", () => {
  assert.equal(list().length, 9);
  assert.equal(byNumber(1), "Dental Cleaning");
  assert.equal(byNumber(8), "Dental Veneers");
  assert.equal(byNumber(9), ASSESSMENT);
  assert.equal(byNumber(10), null);
  assert.equal(byLabel("braces and orthodontic treatment"), "Braces and Orthodontic Treatment");
  assert.deepEqual(panelList(), list());
});

const CHUNKS = new URL("../../../rag/data/index/section/chunks.json", import.meta.url);

test("o catálogo dos testes cobre todos os tratamentos do folheto", { skip: !existsSync(CHUNKS) && "índice do RAG não gerado" }, () => {
  const notTreatments = new Set(["DentalSafe", "Why Choose DentalSafe?", "Schedule Your Assessment Today"]);
  const titles = (JSON.parse(readFileSync(CHUNKS, "utf8")) as { content: string }[])
    .map((c) => c.content.split("\n")[0].split(" — ")[0].trim())
    .filter((t) => !notTreatments.has(t));
  const names = list().map((s) => s.name);
  for (const title of new Set(titles)) assert.ok(names.includes(title), `${title} não está no catálogo`);
});

test("minutes: o tempo do tratamento, ou undefined para a duração padrão (a avaliação inclusive)", async () => {
  const repo = fakeRepo([treatment("limpeza", "Limpeza", 0, { appointmentMinutes: 45 }), treatment("canal", "Canal", 1)]);
  const catalog = createKnowledgeCatalog({ repo });
  await catalog.refresh();
  assert.equal(catalog.minutes("limpeza"), 45);
  assert.equal(catalog.minutes("canal"), undefined);
  assert.equal(catalog.minutes(ASSESSMENT), undefined);
  assert.equal(catalog.minutes("não existe"), undefined);
});
