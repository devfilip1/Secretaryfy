import { FACTS_SEPARATOR } from "./render.js";
import { FIELD_LABELS } from "./texts.js";
import { knowledgeRowSchema, type ClinicData, type KnowledgeRow, type LabelledValue, type TreatmentData } from "./types.js";

const SECTION_PREFIX = "## ";
/** Um tratamento tem uma linha de duração; sem ela a seção é uma informação. */
const DURATION_PREFIXES = ["Duração:", "Duration:"];
const TAGLINE_SEPARATOR = " — ";
/** O preço de um tratamento é, quase sempre, uma faixa: entra com o aviso de avaliação ligado (a clínica pode desligar). */
const PRICE_LABELS = new Set(Object.values(FIELD_LABELS).map((labels) => labels.price));

interface RawSection {
  heading: string;
  lines: string[];
}

/** Separa a brochura em seções: cada "## " abre uma; linhas vazias somem. */
function splitSections(markdown: string): RawSection[] {
  const sections: RawSection[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith(SECTION_PREFIX)) {
      sections.push({ heading: line.slice(SECTION_PREFIX.length).trim(), lines: [] });
    } else if (line) {
      // Texto antes da primeira seção não tem título: recusar é melhor que perder o conteúdo
      if (sections.length === 0) throw new Error(`texto antes da primeira seção da brochura: "${line}"`);
      sections.at(-1)!.lines.push(line);
    }
  }
  return sections;
}

/** "Rótulo: valor" vira um par; qualquer outra forma devolve null. */
function parseLabelled(line: string | undefined): LabelledValue | null {
  if (line === undefined) return null;
  const at = line.indexOf(": ");
  if (at <= 0 || at + 2 >= line.length) return null;
  return { label: line.slice(0, at), value: line.slice(at + 2) };
}

/** Parte o título no primeiro " — "; o que vem depois é o slogan. */
function splitTagline(heading: string): { title: string; tagline: string | null } | null {
  const at = heading.indexOf(TAGLINE_SEPARATOR);
  if (at < 0) return { title: heading, tagline: null };
  const title = heading.slice(0, at);
  const tagline = heading.slice(at + TAGLINE_SEPARATOR.length).trim();
  return title && tagline ? { title, tagline } : null;
}

/**
 * Corpo de um tratamento, lido pela posição: [ideal] [como funciona] / fatos / [resultado] [recuperação].
 * Devolve null quando a forma não bate; a seção então vira informação.
 */
function parseTreatmentBody(lines: string[]): TreatmentData | null {
  const factsAt = lines.findIndex((line) => line.includes(FACTS_SEPARATOR));
  if (factsAt < 0 || lines.some((line, i) => i !== factsAt && line.includes(FACTS_SEPARATOR))) return null;

  const facts = lines[factsAt].split(FACTS_SEPARATOR).map((part) => parseLabelled(part));
  const after = lines.slice(factsAt + 1).map((line) => parseLabelled(line));
  if (after.length > 2 || facts.some((fact) => fact === null) || after.some((pair) => pair === null)) return null;

  let before = lines.slice(0, factsAt);
  let howItWorks: LabelledValue | undefined;
  if (before.length > 0 && !before.at(-1)!.startsWith("- ")) {
    const parsed = parseLabelled(before.at(-1));
    if (!parsed) return null;
    howItWorks = parsed;
    before = before.slice(0, -1);
  }

  let ideal: TreatmentData["ideal"];
  if (before.length > 0) {
    const [head, ...items] = before;
    if (!head.endsWith(":") || items.length === 0 || !items.every((item) => item.startsWith("- "))) return null;
    ideal = { title: head.slice(0, -1), items: items.map((item) => item.slice(2)) };
  }

  return {
    ideal,
    howItWorks,
    facts: (facts as LabelledValue[]).map((fact) => (PRICE_LABELS.has(fact.label) ? { ...fact, assessment: true } : fact)),
    result: after[0] ?? undefined,
    recovery: after[1] ?? undefined,
  };
}

/** Uma linha que parece telefone: só algarismos e sinais de pontuação, com pelo menos 6 algarismos. Sem palavras. */
function looksLikePhone(line: string | undefined): boolean {
  return line !== undefined && /^[\d\s()+.-]+$/.test(line) && (line.match(/\d/g)?.length ?? 0) >= 6;
}

/** Partes da seção da clínica: a abertura, o endereço, o contato e as linhas do horário que as regras passam a ter. */
interface ClinicParse {
  data: ClinicData;
  droppedHours: string[];
}

/**
 * A seção que tem os três títulos da clínica (na língua da clínica, ou na outra) vira `clinic`. Antes do endereço é a
 * abertura; as linhas do horário saem (o horário é das regras); depois do contato vêm telefone, e-mail e fechamento.
 * Devolve null quando não bate: a seção então fica como informação.
 */
function parseClinicBody(lines: string[]): ClinicParse | null {
  for (const labels of [FIELD_LABELS.pt, FIELD_LABELS.en]) {
    const addressAt = lines.indexOf(labels.address);
    const hoursAt = lines.indexOf(labels.hours);
    const contactAt = lines.indexOf(labels.contact);
    if (addressAt < 0 || hoursAt <= addressAt || contactAt <= hoursAt) continue;

    const address = lines.slice(addressAt + 1, hoursAt);
    const rest = lines.slice(contactAt + 1);
    const phone = looksLikePhone(rest[0]) ? rest[0] : undefined;
    const emailAt = phone ? 1 : 0;
    const email = rest[emailAt]?.includes("@") ? rest[emailAt] : undefined;
    const closing = rest.slice(emailAt + (email ? 1 : 0));
    if (address.length === 0 || closing.some((line) => line.includes("@"))) return null;

    return {
      data: {
        intro: lines.slice(0, addressAt),
        address,
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        closing,
      },
      droppedHours: lines.slice(hoursAt + 1, contactAt),
    };
  }
  return null;
}

export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "secao";
}

function infoRow(section: RawSection, position: number): KnowledgeRow {
  return {
    key: slugify(section.heading),
    kind: "info",
    title: section.heading,
    tagline: null,
    data: { lines: section.lines },
    position,
  };
}

function treatmentOrInfoRow(section: RawSection, position: number): KnowledgeRow {
  const isTreatment = section.lines.some((line) => DURATION_PREFIXES.some((prefix) => line.startsWith(prefix)));
  if (!isTreatment) return infoRow(section, position);

  const parts = splitTagline(section.heading);
  const data = parts ? parseTreatmentBody(section.lines) : null;
  if (!parts || !data) return infoRow(section, position);
  return {
    key: slugify(parts.title),
    kind: "treatment",
    title: parts.title,
    tagline: parts.tagline,
    data,
    position,
  };
}

/** Chaves únicas: duas seções com o mesmo título ganham sufixo "-2", "-3"… */
function withUniqueKeys(rows: KnowledgeRow[]): KnowledgeRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const count = (seen.get(row.key) ?? 0) + 1;
    seen.set(row.key, count);
    return count === 1 ? row : { ...row, key: `${row.key}-${count}` };
  });
}

/**
 * Converte a brochura em Markdown nas linhas de knowledge_sections. Seção que não se lê com certeza vira informação.
 * `droppedHours`: as linhas de horário da seção da clínica que não foram guardadas (o horário vem das regras de atendimento).
 */
export function importBrochure(markdown: string): { rows: KnowledgeRow[]; droppedHours: string[] } {
  const droppedHours: string[] = [];
  const rows = splitSections(markdown).map((section, position) => {
    const clinic = parseClinicBody(section.lines);
    if (!clinic) return treatmentOrInfoRow(section, position);
    droppedHours.push(...clinic.droppedHours);
    return { key: slugify(section.heading), kind: "clinic", title: section.heading, tagline: null, data: clinic.data, position } as KnowledgeRow;
  });
  return { rows: withUniqueKeys(rows).map((row) => knowledgeRowSchema.parse(row)), droppedHours };
}

/** Converte a brochura em linhas de knowledge_sections (ver importBrochure). */
export function parseBrochure(markdown: string): KnowledgeRow[] {
  return importBrochure(markdown).rows;
}
