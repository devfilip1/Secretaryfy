// Importa uma brochura Markdown (uma seção por "## ") para a tabela knowledge_sections, trocando o conteúdo inteiro.
// Uso: npx tsx --env-file=.env scripts/import-knowledge.ts <arquivo.md>
import { readFileSync } from "node:fs";
import { sql, db } from "../src/db/client.js";
import { importBrochure } from "../src/modules/knowledge/import-markdown.js";
import { createKnowledgeRepository } from "../src/modules/knowledge/repository.js";

const file = process.argv[2];
if (!file) {
  console.error("Uso: npx tsx --env-file=.env scripts/import-knowledge.ts <arquivo.md>");
  process.exit(1);
}

const { rows, droppedHours } = importBrochure(readFileSync(file, "utf8"));
await createKnowledgeRepository(db).replaceAll(rows);
console.log(`${rows.length} seções importadas de ${file}`);
// O horário não é guardado: vem das regras de atendimento (Calendário). Confira se bate com elas.
if (droppedHours.length > 0) {
  console.log("Horário da brochura ignorado (o horário vem das regras de atendimento):");
  for (const line of droppedHours) console.log(`  ${line}`);
}
await sql.end();
