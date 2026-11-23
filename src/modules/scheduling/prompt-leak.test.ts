import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Raiz do repositório (este arquivo está em src/modules/scheduling/). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Tabelas de avaliação: as frases de cliente nelas não podem reaparecer nos prompts (senão a medição vira decoreba). */
const EVAL_FILES = [
  "scripts/eval-interpret.ts",
  "scripts/eval-extractors.ts",
  "scripts/eval-scheduling.ts",
  "scripts/fixtures/scheduling-scenarios.json",
];

/** Arquivos que contêm texto enviado ao modelo. */
const PROMPT_FILES = [
  "src/modules/scheduling/interpret/prompt.ts",
  "src/modules/scheduling/understanding/when.ts",
  "src/modules/scheduling/understanding/option.ts",
  "src/modules/scheduling/understanding/sense.ts",
  "src/modules/scheduling/understanding/agreement.ts",
];

/** Frases genéricas do dia a dia, aceitas nos prompts mesmo batendo com uma frase de avaliação. Qualquer outra com 2 palavras ou mais é proibida. */
const GENERIC_PHRASES = new Set(["the first one", "i want to book"]);

/** Minúsculas, sem acento e com pontuação virando espaço: a mesma forma para a frase e para o texto do prompt. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();
}

/** Remove comentários de bloco e de linha inteira, para que apóstrofos de comentários não virem "literais". */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/** Literais de texto ('…' ou "…") de um arquivo TypeScript, numa linha cada. */
function tsStringLiterals(source: string): string[] {
  const literals: string[] = [];
  const pattern = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;
  for (const match of stripComments(source).matchAll(pattern)) literals.push(match[1] ?? match[2] ?? "");
  return literals;
}

/** Todos os valores de texto de um JSON (não as chaves). */
function jsonStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(jsonStringValues);
  return [];
}

function readRepoFile(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/** Frases de cliente (normalizadas) de todas as tabelas de avaliação, cada uma com o arquivo de origem. */
function evalPhrases(): Map<string, string> {
  const phrases = new Map<string, string>();
  for (const file of EVAL_FILES) {
    const raw = readRepoFile(file);
    const literals = file.endsWith(".json") ? jsonStringValues(JSON.parse(raw)) : tsStringLiterals(raw);
    for (const literal of literals.filter(isCustomerText)) {
      const phrase = normalize(literal);
      if (phrase.split(" ").length >= 2 && !phrases.has(phrase)) phrases.set(phrase, file);
    }
  }
  return phrases;
}

/** Uma frase de 2 palavras ou mais é proibida nos prompts (de 2, 3 ou 4+ palavras), salvo as genéricas da lista. */
function isForbidden(phrase: string): boolean {
  return !GENERIC_PHRASES.has(phrase);
}

/** Literais que não são texto de cliente: identificadores (`who_are_you`), horários e datas (`09:00`, `2026-10-21T10:00`). */
function isCustomerText(literal: string): boolean {
  if (/^[a-z]+(_[a-z]+)+$/.test(literal)) return false;
  if (/^[\d\s:.\-/TZ+]+$/.test(literal)) return false;
  return true;
}

test("frases das tabelas de avaliação não aparecem nos prompts", () => {
  const phrases = evalPhrases();
  assert.ok(phrases.size > 50, `poucas frases de avaliação lidas (${phrases.size}): o teste não está enxergando as tabelas`);

  const violations: string[] = [];
  for (const promptFile of PROMPT_FILES) {
    const promptText = ` ${normalize(readRepoFile(promptFile))} `;
    for (const [phrase, evalFile] of phrases) {
      if (!isForbidden(phrase)) continue;
      if (promptText.includes(` ${phrase} `)) violations.push(`${promptFile}: "${phrase}" (copiada de ${evalFile})`);
    }
  }

  assert.equal(
    violations.length,
    0,
    `frases de avaliação copiadas nos prompts (trocar por outras palavras que ensinem a mesma regra):\n  ${violations.join("\n  ")}`,
  );
});
