import assert from "node:assert/strict";
import { test } from "node:test";
import { createCatalog } from "./catalog.js";
import type { Language } from "./dates.js";
import { createHumanizer } from "./humanize.js";
import { formatFor, mentionFormat } from "./interpret/prompt.js";
import { createAgreementReader } from "./understanding/agreement.js";
import { createOptionExtractor } from "./understanding/option.js";
import { createSenseReader } from "./understanding/sense.js";
import { createWhenExtractor } from "./understanding/when.js";

/**
 * Os schemas que vão ao modelo (Ollama `format`, OpenAI-compatível `json_schema` strict) têm de passar no modo estrito
 * do Azure OpenAI: todo objeto tem additionalProperties false e todas as suas propriedades em required. Quem precisa de
 * ausência usa null, não propriedade fora de required.
 */

type Walked = { name: string; schema: unknown };

/** Ollama falso que guarda o `format` da chamada e responde sem conteúdo (a leitura cai no caminho de falha). */
function capturingOllama() {
  const seen: { format?: unknown } = {};
  return {
    seen,
    ollama: {
      chat: async (args: { format?: unknown }) => {
        seen.format = args.format;
        return {};
      },
    },
  };
}

/** Coleta os schemas que o módulo monta de fato, na língua dada: as funções exportadas e os extratores que os usam. */
async function collectSchemas(language: Language): Promise<Walked[]> {
  const catalog = createCatalog([{ name: "limpeza-dental", label: language === "pt" ? "Limpeza dental" : "Dental cleaning" }]);
  const clinic = { name: "DentalSafe", language };
  const schemas: Walked[] = [
    { name: "interpret/prompt formatFor", schema: formatFor(catalog, language) },
    { name: "interpret/prompt mentionFormat", schema: mentionFormat(catalog, language) },
  ];

  const when = capturingOllama();
  await createWhenExtractor({ ollama: when.ollama })({ text: "quero às 14h" });
  schemas.push({ name: "understanding/when whenFormat", schema: when.seen.format });

  const pick = capturingOllama();
  await createOptionExtractor({ ollama: pick.ollama })({ text: "o primeiro", count: 2 });
  schemas.push({ name: "understanding/option pickFormat", schema: pick.seen.format });

  const sense = capturingOllama();
  await createSenseReader({ ollama: sense.ollama })({ text: "oi" });
  schemas.push({ name: "understanding/sense senseFormat", schema: sense.seen.format });

  const agreement = capturingOllama();
  await createAgreementReader({ ollama: agreement.ollama })({ text: "sim" });
  schemas.push({ name: "understanding/agreement agreementFormat", schema: agreement.seen.format });

  const humanize = capturingOllama();
  await createHumanizer({ ollama: humanize.ollama, clinic }).humanize("Olá");
  schemas.push({ name: "humanize FORMAT", schema: humanize.seen.format });

  return schemas;
}

/** Percorre o schema e devolve uma linha por violação, com o nome do schema e o caminho até o objeto ou a propriedade. */
function strictViolations(name: string, node: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item, i) => strictViolations(name, item, `${path}[${i}]`, out));
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  const obj = node as Record<string, unknown>;
  const types = Array.isArray(obj.type) ? obj.type : [obj.type];
  if (types.includes("object")) {
    const properties = (obj.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(obj.required) ? obj.required : [];
    if (obj.additionalProperties !== false) out.push(`${name} em "${path || "/"}": objeto sem additionalProperties: false`);
    for (const key of Object.keys(properties)) {
      if (!required.includes(key)) out.push(`${name} em "${path}/${key}": propriedade fora de required`);
    }
    for (const [key, value] of Object.entries(properties)) strictViolations(name, value, `${path}/${key}`, out);
  }
  if ("items" in obj) strictViolations(name, obj.items, `${path}/items`, out);
  return out;
}

test("o verificador pega propriedade fora de required e objeto sem additionalProperties", () => {
  const bad = { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a"] };
  const found = strictViolations("exemplo", bad);
  assert.equal(found.length, 2);
  assert.ok(found.every((line) => line.includes("exemplo")));
  assert.ok(found.some((line) => line.includes('"/b"')));
});

for (const language of ["en", "pt"] as const) {
  test(`schemas são estritos (${language})`, async () => {
    const schemas = await collectSchemas(language);
    assert.ok(schemas.length >= 6, "todos os schemas do módulo entram na conferência");
    const violations = schemas.flatMap(({ name, schema }) => strictViolations(name, schema));
    assert.deepEqual(violations, [], violations.join("\n"));
  });
}

test("formatFor põe todas as propriedades em required, inclusive o timeWindow aninhado", () => {
  const schema = formatFor(createCatalog([]), "en") as { properties: Record<string, unknown>; required: string[] };
  const timeWindow = (schema.properties.timeWindow as { properties: Record<string, unknown>; required: string[] });
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  assert.deepEqual([...timeWindow.required].sort(), Object.keys(timeWindow.properties).sort());
});
