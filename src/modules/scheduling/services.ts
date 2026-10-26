/**
 * Serviços que o cliente pode marcar: os tratamentos do folheto, com o nome em inglês como lá, e a avaliação geral
 * (specs/005, research.md R4). A ordem é a da lista numerada.
 */
export const ASSESSMENT = "Assessment";

export const SERVICES: { name: string; words: string[] }[] = [
  { name: "Dental Cleaning", words: ["clean", "cleaning", "prophylaxis", "tartar", "plaque"] },
  { name: "Teeth Whitening", words: ["whitening", "whiten", "whiter", "bleach", "bleaching"] },
  { name: "Dental Filling", words: ["filling", "fillings", "cavity", "cavities", "decay"] },
  { name: "Root Canal Treatment", words: ["root canal", "endodontic"] },
  { name: "Dental Implants", words: ["implant", "implants"] },
  {
    name: "Braces and Orthodontic Treatment",
    words: ["braces", "aligners", "invisalign", "orthodontic", "orthodontics", "straighten", "crooked"],
  },
  { name: "Tooth Extraction", words: ["extraction", "extract", "pull", "pulled", "wisdom"] },
  { name: "Dental Veneers", words: ["veneer", "veneers"] },
  { name: ASSESSMENT, words: ["not sure", "dont know", "no idea", "assessment", "check up", "checkup", "evaluation"] },
];

/** Minúsculas, sem acento, sem apóstrofo ("don't" → "dont"), pontuação vira espaço. */
const normalize = (text: string) =>
  ` ${text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** Posição da última palavra do serviço no texto, ou -1. */
function lastMention(text: string, words: string[]): number {
  return Math.max(...words.map((w) => text.lastIndexOf(` ${w} `)));
}

/** O serviço citado por último nos textos (em ordem cronológica), ou null se nenhum (FR-010). */
export function detectService(texts: string[]): string | null {
  for (const raw of [...texts].reverse()) {
    const text = normalize(raw);
    let best: { name: string; at: number } | null = null;
    for (const s of SERVICES) {
      const at = lastMention(text, s.words);
      if (at >= 0 && (!best || at > best.at)) best = { name: s.name, at };
    }
    if (best) return best.name;
  }
  return null;
}

/** O serviço pelo número da lista (1 a 9). */
export function serviceByNumber(n: number): string | null {
  return SERVICES[n - 1]?.name ?? null;
}

/** Como o serviço aparece para o cliente. */
export function serviceLabel(service: string): string {
  return service === ASSESSMENT ? "General assessment" : service;
}
