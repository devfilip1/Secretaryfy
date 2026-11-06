import type { Language } from "./dates.js";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import { isBookable } from "../knowledge/types.js";

/**
 * O nome da avaliação geral, sempre presente na lista (specs/005, research.md R4). Fica em inglês, como o nome de um
 * tratamento: é o valor guardado em appointments.service.
 */
export const ASSESSMENT = "Assessment";

/** Como a avaliação geral aparece ao cliente, em cada língua da clínica (o único rótulo escrito no código). */
const ASSESSMENT_LABEL: Record<Language, string> = { en: "General assessment", pt: "Avaliação geral" };

/** Um serviço que o cliente pode marcar: o nome guardado (a chave do tratamento, ou ASSESSMENT) e o rótulo da lista. */
export interface Service {
  name: string;
  label: string;
}

/**
 * Catálogo dos serviços que o cliente pode marcar (ADR 0014). Os métodos são síncronos: o catálogo guarda um retrato em
 * memória, que o `refresh` do catálogo do banco atualiza.
 */
export interface ServiceCatalog {
  /** Os serviços na ordem da lista numerada, com a avaliação geral no fim */
  list(): Service[];
  /** O serviço pelo número da lista (1 a N), ou null */
  byNumber(n: number): string | null;
  /** Como o serviço aparece ao cliente, na língua pedida; um nome que não está no catálogo volta igual */
  label(name: string, language?: Language): string;
  /** O serviço cujo rótulo (ou nome) é este texto, sem acento nem caixa; null se nenhum. Sem busca aproximada. */
  byLabel(text: string): string | null;
  /** Os serviços para a lista do painel */
  panelList(): Service[];
}

/** Minúsculas, sem acento, e pontuação vira espaço: o que um rótulo e o texto do cliente têm em comum. */
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** O catálogo a partir dos tratamentos que se podem marcar, na ordem da lista: a avaliação geral entra no fim. */
export function createCatalog(treatments: Service[]): ServiceCatalog {
  const services: Service[] = [...treatments, { name: ASSESSMENT, label: ASSESSMENT_LABEL.en }];
  const byText = new Map<string, string>();
  for (const s of services) {
    const texts = [s.name, s.label, ...(s.name === ASSESSMENT ? Object.values(ASSESSMENT_LABEL) : [])];
    for (const text of texts) byText.set(normalize(text), s.name);
  }
  return {
    list: () => [...services],
    byNumber: (n) => services[n - 1]?.name ?? null,
    label(name, language = "en") {
      if (name === ASSESSMENT) return ASSESSMENT_LABEL[language];
      return services.find((s) => s.name === name)?.label ?? name;
    },
    byLabel: (text) => byText.get(normalize(text)) ?? null,
    panelList: () => [...services],
  };
}

export interface KnowledgeCatalog extends ServiceCatalog {
  /** Relê a tabela de conhecimento e troca o retrato: no boot e depois de cada mudança no painel */
  refresh(): Promise<void>;
}

/**
 * Os tratamentos que o cliente pode marcar são as seções de tratamento da tabela de conhecimento, sem `bookable: false`,
 * na ordem da posição (ADR 0014). O nome guardado é a chave da seção; o rótulo é o título.
 */
export function createKnowledgeCatalog({ repo }: { repo: Pick<KnowledgeRepository, "list"> }): KnowledgeCatalog {
  let current = createCatalog([]);
  return {
    list: () => current.list(),
    byNumber: (n) => current.byNumber(n),
    label: (name, language) => current.label(name, language),
    byLabel: (text) => current.byLabel(text),
    panelList: () => current.panelList(),
    async refresh() {
      const rows = await repo.list();
      current = createCatalog(rows.filter(isBookable).map((row) => ({ name: row.key, label: row.title })));
    },
  };
}
