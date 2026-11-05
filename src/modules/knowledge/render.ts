import { createHash } from "node:crypto";
import type { Language } from "../scheduling/dates.js";
import { ASSESSMENT_NOTE } from "./texts.js";
import type { Fact, KnowledgeRow, KnowledgeSection, LabelledValue, TreatmentData } from "./types.js";

/** Separador das informações da linha de fatos (três espaços, barra, três espaços), como na brochura. */
export const FACTS_SEPARATOR = "   |   ";

/** Documento que o RAG consome: nome, versão (hash do conteúdo) e seções. */
export interface KnowledgeDocument {
  name: string;
  version: string;
  sections: KnowledgeSection[];
}

const labelled = ({ label, value }: LabelledValue): string => `${label}: ${value}`;

/** Título da seção: o do tratamento leva o slogan depois de " — ", como os trechos do RAG sempre levaram. */
function sectionTitle(row: KnowledgeRow): string {
  return row.kind === "treatment" && row.tagline ? `${row.title} — ${row.tagline}` : row.title;
}

/** Um fato da linha; com `assessment`, o aviso da língua da clínica vem colado nele, antes do separador. */
const fact = (item: Fact, language: Language): string =>
  item.assessment ? `${labelled(item)} ${ASSESSMENT_NOTE[language]}` : labelled(item);

function treatmentBody(data: TreatmentData, language: Language): string[] {
  const lines: string[] = [];
  if (data.ideal) {
    lines.push(`${data.ideal.title}:`);
    for (const item of data.ideal.items) lines.push(`- ${item}`);
  }
  if (data.howItWorks) lines.push(labelled(data.howItWorks));
  lines.push(data.facts.map((item) => fact(item, language)).join(FACTS_SEPARATOR));
  if (data.result) lines.push(labelled(data.result));
  if (data.recovery) lines.push(labelled(data.recovery));
  return lines;
}

/** Seções na ordem de `position` (sem alterar as linhas recebidas). */
export function toSections(rows: KnowledgeRow[], language: Language): KnowledgeSection[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      title: sectionTitle(row),
      body: row.kind === "treatment" ? treatmentBody(row.data, language) : [...row.data.lines],
    }));
}

/** Versão do conteúdo: muda com qualquer edição de nome ou seção. */
export function versionOf(name: string, sections: KnowledgeSection[]): string {
  return createHash("sha256").update(JSON.stringify({ name, sections })).digest("hex");
}

/** Documento para o RAG, na língua da clínica (os avisos dos fatos com `assessment` saem nela). */
export function toDocument(name: string, rows: KnowledgeRow[], language: Language): KnowledgeDocument {
  const sections = toSections(rows, language);
  return { name, version: versionOf(name, sections), sections };
}
