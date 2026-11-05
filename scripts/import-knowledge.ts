// Importa uma brochura Markdown (uma seção por "## ") para a tabela knowledge_sections, trocando o conteúdo inteiro.
// Uso: npx tsx --env-file=.env scripts/import-knowledge.ts <arquivo.md>
import { readFileSync } from "node:fs";
import { sql, db } from "../src/db/client.js";
import { parseBrochure } from "../src/modules/knowledge/import-markdown.js";
import { createKnowledgeRepository } from "../src/modules/knowledge/repository.js";

const file = process.argv[2];
if (!file) {
  console.error("Uso: npx tsx --env-file=.env scripts/import-knowledge.ts <arquivo.md>");
  process.exit(1);
}

const rows = parseBrochure(readFileSync(file, "utf8"));
await createKnowledgeRepository(db).replaceAll(rows);
console.log(`${rows.length} seções importadas de ${file}`);
await sql.end();
