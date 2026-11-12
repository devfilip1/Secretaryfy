import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { testCatalog } from "../../test/catalog.js";
import { createClinicContext } from "../clinic/context.js";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import { isBookable, type KnowledgeRow } from "../knowledge/types.js";
import { ASSESSMENT, createCatalog, createKnowledgeCatalog, FOLLOW_UP, type Service, type ServiceOffers } from "./catalog.js";

const { list, byNumber, label, byLabel, panelList } = testCatalog;

const treatment = (key: string, title: string, position: number, data: Record<string, unknown> = {}): KnowledgeRow =>
  ({ key, kind: "treatment", title, tagline: null, position, data: { facts: [{ label: "Preço", value: "R$ 40" }], ...data } }) as KnowledgeRow;
const info = (key: string, position: number): KnowledgeRow => ({ key, kind: "info", title: "Sobre nós", tagline: null, position, data: { lines: ["Linha"] } }) as KnowledgeRow;

/** Repositório falso cujas linhas o teste troca: o catálogo só vê uma mudança no refresh. */
function fakeRepo(rows: KnowledgeRow[]): Pick<KnowledgeRepository, "list"> & { rows: KnowledgeRow[] } {
  const repo = { rows, list: async () => repo.rows };
  return repo;
}

/** Os serviços fixos da clínica: o padrão (avaliação sim, retorno não, duração padrão) mudado no que o teste pede. */
const offers = (o: Partial<ServiceOffers> = {}): ServiceOffers => ({
  offerAssessment: true,
  offerFollowUp: false,
  assessmentMinutes: null,
  followUpMinutes: null,
  ...o,
});

const TWO: Service[] = [
  { name: "A", label: "Alfa" },
  { name: "B", label: "Beta", minutes: 45 },
];

test("a lista é dos tratamentos da tabela que podem ser marcados, na posição, com a avaliação no fim", async () => {
  const repo = fakeRepo([
    treatment("limpeza-dental", "Limpeza Dental", 0),
    info("sobre-nos", 1),
    treatment("clareamento", "Clareamento", 2),
    treatment("siso", "Extração do siso", 3, { bookable: false }),
    treatment("implante", "Implante", 4),
  ]);
  const catalog = createKnowledgeCatalog({ repo, clinic: offers() });
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
  const catalog = createKnowledgeCatalog({ repo, clinic: offers() });
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
  const catalog = createKnowledgeCatalog({ repo, clinic: offers() });
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
  const catalog = createKnowledgeCatalog({ repo, clinic: offers() });
  await catalog.refresh();
  assert.equal(catalog.minutes("limpeza"), 45);
  assert.equal(catalog.minutes("canal"), undefined);
  assert.equal(catalog.minutes(ASSESSMENT), undefined);
  assert.equal(catalog.minutes("não existe"), undefined);
});

// --- Avaliação e retorno: as quatro combinações das ofertas da clínica ---

test("as quatro combinações: o retorno entra antes da avaliação, e cada um só quando a clínica o oferece", () => {
  const cases: [Partial<ServiceOffers>, string[]][] = [
    [{ offerAssessment: false, offerFollowUp: false }, ["A", "B"]],
    [{ offerAssessment: true, offerFollowUp: false }, ["A", "B", ASSESSMENT]],
    [{ offerAssessment: false, offerFollowUp: true }, ["A", "B", FOLLOW_UP]],
    [{ offerAssessment: true, offerFollowUp: true }, ["A", "B", FOLLOW_UP, ASSESSMENT]],
  ];
  for (const [o, names] of cases) {
    assert.deepEqual(
      createCatalog(TWO, offers(o)).list().map((s) => s.name),
      names,
      JSON.stringify(o),
    );
  }
  assert.deepEqual(
    createCatalog(TWO).list().map((s) => s.name),
    ["A", "B", ASSESSMENT],
    "sem configuração: a avaliação entra, o retorno não",
  );
});

test("o retorno tem rótulo nas duas línguas e entra pelo rótulo ou pelo nome; a avaliação some da busca quando não é oferecida", () => {
  const on = createCatalog(TWO, offers({ offerFollowUp: true }));
  assert.equal(on.label(FOLLOW_UP, "pt"), "Retorno");
  assert.equal(on.label(FOLLOW_UP, "en"), "Follow-up visit");
  assert.equal(on.byLabel("retorno"), FOLLOW_UP);
  assert.equal(on.byLabel("Follow-up visit"), FOLLOW_UP);
  assert.equal(on.byLabel("FollowUp"), FOLLOW_UP);
  assert.equal(on.byLabel("Avaliação geral"), ASSESSMENT);

  const off = createCatalog(TWO, offers({ offerAssessment: false }));
  assert.equal(off.byLabel("Avaliação geral"), null, "a avaliação desligada não se marca por rótulo");
  assert.equal(off.byNumber(3), null);
});

test("minutos do retorno e da avaliação vêm da configuração; sem ela, undefined (duração padrão)", () => {
  const catalog = createCatalog(TWO, offers({ offerFollowUp: true, followUpMinutes: 45, assessmentMinutes: null }));
  assert.equal(catalog.minutes(FOLLOW_UP), 45);
  assert.equal(catalog.minutes(ASSESSMENT), undefined);
  assert.deepEqual(catalog.panelList().at(-2), { name: FOLLOW_UP, label: "Follow-up visit", minutes: 45 });
  assert.deepEqual(createCatalog(TWO, offers({ assessmentMinutes: 30 })).panelList().at(-1), { name: ASSESSMENT, label: "General assessment", minutes: 30 });
});

test("uma avaliação já marcada continua com rótulo e tempo mesmo quando a clínica desligou a oferta", () => {
  const off = createCatalog(TWO, offers({ offerAssessment: false, assessmentMinutes: 30 }));
  assert.equal(off.label(ASSESSMENT, "pt"), "Avaliação geral");
  assert.equal(off.label(ASSESSMENT, "en"), "General assessment");
  assert.equal(off.minutes(ASSESSMENT), 30);
  assert.equal(off.list().some((s) => s.name === ASSESSMENT), false);
});

test("a troca nas ofertas da clínica vale sem reiniciar: o catálogo lê a clínica a cada chamada", async () => {
  const clinic = createClinicContext({ name: "DentalSafe", kind: "dental clinic", language: "en" });
  const repo = fakeRepo([treatment("clareamento", "Clareamento", 0)]);
  const catalog = createKnowledgeCatalog({ repo, clinic });
  await catalog.refresh();
  assert.deepEqual(catalog.list().map((s) => s.name), ["clareamento", ASSESSMENT]);

  clinic.update({ offerAssessment: false, offerFollowUp: true, followUpMinutes: 45 });
  assert.deepEqual(catalog.list().map((s) => s.name), ["clareamento", FOLLOW_UP]);
  assert.equal(catalog.minutes(FOLLOW_UP), 45);
  assert.equal(catalog.byLabel("Retorno"), FOLLOW_UP);
  assert.equal(catalog.label(ASSESSMENT, "pt"), "Avaliação geral", "o que já foi marcado segue com rótulo");
});
