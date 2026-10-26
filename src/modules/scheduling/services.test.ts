import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ASSESSMENT, SERVICES, detectService, serviceByNumber, serviceLabel } from "./services.js";

test("o tratamento citado na conversa vira o serviço; vale o citado por último", () => {
  assert.equal(detectService(["Do you offer a clean procedure?", "how much does cost it?"]), "Dental Cleaning");
  assert.equal(detectService(["How much is whitening?", "and braces?"]), "Braces and Orthodontic Treatment");
  assert.equal(detectService(["braces or whitening, which is cheaper?"]), "Teeth Whitening");
  assert.equal(detectService(["I need a ROOT CANAL"]), "Root Canal Treatment");
  assert.equal(detectService(["Hi", "where are you located?"]), null);
});

test("'não sei' vira avaliação geral", () => {
  for (const text of ["not sure", "I don't know", "no idea", "just a check-up"]) assert.equal(detectService([text]), ASSESSMENT, text);
});

test("palavra inteira, sem caixa e sem acento", () => {
  assert.equal(detectService(["my tooth must be pulled"]), "Tooth Extraction");
  assert.equal(detectService(["I like your pullover"]), null);
  assert.equal(detectService(["CLEANING"]), "Dental Cleaning");
});

test("número da lista: 1 a 9, na ordem do folheto, com a avaliação no fim", () => {
  assert.equal(serviceByNumber(1), "Dental Cleaning");
  assert.equal(serviceByNumber(8), "Dental Veneers");
  assert.equal(serviceByNumber(9), ASSESSMENT);
  assert.equal(serviceByNumber(0), null);
  assert.equal(serviceByNumber(10), null);
  assert.equal(serviceLabel(ASSESSMENT), "General assessment");
  assert.equal(serviceLabel("Dental Cleaning"), "Dental Cleaning");
});

const CHUNKS = new URL("../../../rag/data/index/section/chunks.json", import.meta.url);

test("o catálogo cobre todos os tratamentos do folheto", { skip: !existsSync(CHUNKS) && "índice do RAG não gerado" }, () => {
  const notTreatments = new Set(["DentalSafe", "Why Choose DentalSafe?", "Schedule Your Assessment Today"]);
  const titles = (JSON.parse(readFileSync(CHUNKS, "utf8")) as { content: string }[])
    .map((c) => c.content.split("\n")[0].split(" — ")[0].trim())
    .filter((t) => !notTreatments.has(t));
  const names = SERVICES.map((s) => s.name);
  for (const title of new Set(titles)) assert.ok(names.includes(title), `${title} não está no catálogo`);
});
