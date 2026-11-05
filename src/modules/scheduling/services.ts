import type { Language } from "./dates.js";

/**
 * Serviços que o cliente pode marcar: os tratamentos do folheto, com o nome em inglês como lá (é o valor guardado no
 * banco), o nome em português para a conversa em pt e a avaliação geral (specs/005, research.md R4). A ordem é a da
 * lista numerada.
 */
export const ASSESSMENT = "Assessment";

export const SERVICES: { name: string; labelPt: string; words: string[]; wordsPt: string[] }[] = [
  {
    name: "Dental Cleaning",
    labelPt: "Limpeza Dental",
    words: ["clean", "cleaning", "prophylaxis", "tartar", "plaque"],
    wordsPt: ["limpeza", "limpar", "profilaxia", "tartaro", "placa"],
  },
  {
    name: "Teeth Whitening",
    labelPt: "Clareamento Dental",
    words: ["whitening", "whiten", "whiter", "bleach", "bleaching"],
    wordsPt: ["clareamento", "clarear", "branqueamento", "branquear"],
  },
  {
    name: "Dental Filling",
    labelPt: "Restauração Dental",
    words: ["filling", "fillings", "cavity", "cavities", "decay"],
    wordsPt: ["restauracao", "restauracoes", "obturacao", "carie", "caries"],
  },
  {
    name: "Root Canal Treatment",
    labelPt: "Tratamento de Canal",
    words: ["root canal", "endodontic"],
    wordsPt: ["canal", "endodontia", "tratamento de canal"],
  },
  { name: "Dental Implants", labelPt: "Implante Dentário", words: ["implant", "implants"], wordsPt: ["implante", "implantes"] },
  {
    name: "Braces and Orthodontic Treatment",
    labelPt: "Aparelho e Tratamento Ortodôntico",
    words: ["braces", "aligners", "invisalign", "orthodontic", "orthodontics", "straighten", "crooked"],
    wordsPt: ["aparelho", "aparelhos", "ortodontia", "ortodontico", "alinhador", "alinhadores", "torto", "tortos"],
  },
  {
    name: "Tooth Extraction",
    labelPt: "Extração Dentária",
    words: ["extraction", "extract", "pull", "pulled", "wisdom"],
    wordsPt: ["extracao", "extrair", "siso", "sisos", "tirar dente", "arrancar"],
  },
  {
    name: "Dental Veneers",
    labelPt: "Lentes de Contato Dental",
    words: ["veneer", "veneers"],
    wordsPt: ["lente", "lentes", "faceta", "facetas"],
  },
  {
    name: ASSESSMENT,
    labelPt: "Avaliação geral",
    words: ["not sure", "dont know", "no idea", "assessment", "check up", "checkup", "evaluation"],
    wordsPt: ["nao sei", "nao tenho certeza", "avaliacao"],
  },
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
      const at = lastMention(text, [...s.words, ...s.wordsPt]);
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

/** Como o serviço aparece para o cliente, na língua da clínica. */
export function serviceLabel(service: string, language: Language = "en"): string {
  const found = SERVICES.find((s) => s.name === service);
  if (language === "pt") return found?.labelPt ?? service;
  return service === ASSESSMENT ? "General assessment" : service;
}

/** Os serviços para a lista do painel: nome e rótulo em inglês, na ordem de SERVICES. */
export function panelServices(): { name: string; label: string }[] {
  return SERVICES.map((s) => ({ name: s.name, label: serviceLabel(s.name) }));
}
