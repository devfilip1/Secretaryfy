import type { ClinicContext } from "../clinic/context.js";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import { isBookable } from "../knowledge/types.js";
import type { Language } from "./dates.js";

/**
 * O nome da avaliação geral (specs/005, research.md R4). Fica em inglês, como o nome de um tratamento: é o valor guardado
 * em appointments.service. A lista só a traz quando a clínica a oferece; o rótulo continua valendo para o que já foi marcado.
 */
export const ASSESSMENT = "Assessment";

/** O retorno (acompanhamento): serviço fixo como a avaliação, com o nome guardado e o rótulo do mesmo jeito. */
export const FOLLOW_UP = "FollowUp";

/** Como cada serviço fixo aparece ao cliente, em cada língua da clínica (os únicos rótulos escritos no código). */
const FIXED_LABELS = new Map<string, Record<Language, string>>([
  [ASSESSMENT, { en: "General assessment", pt: "Avaliação geral" }],
  [FOLLOW_UP, { en: "Follow-up visit", pt: "Retorno" }],
]);

/** Os serviços fixos que a clínica oferece e o tempo de cada um (null = a duração padrão do calendário): o que o painel edita. */
export type ServiceOffers = Pick<ClinicContext, "offerAssessment" | "offerFollowUp" | "assessmentMinutes" | "followUpMinutes">;

/** Sem configuração, a avaliação entra e o retorno não (padrões de clinic_settings). */
const DEFAULT_OFFERS: ServiceOffers = { offerAssessment: true, offerFollowUp: false, assessmentMinutes: null, followUpMinutes: null };

/** Um serviço que o cliente pode marcar: o nome guardado (a chave do tratamento, ou um serviço fixo) e o rótulo da lista. */
export interface Service {
  name: string;
  label: string;
  /** Tempo bloqueado na agenda; sem ele vale a duração padrão das regras (ADR 0015) */
  minutes?: number;
}

/**
 * Catálogo dos serviços que o cliente pode marcar (ADR 0014). Os métodos são síncronos: o catálogo guarda um retrato em
 * memória, que o `refresh` do catálogo do banco atualiza.
 */
export interface ServiceCatalog {
  /** Os serviços na ordem da lista numerada: tratamentos, retorno (se oferecido), avaliação geral (se oferecida) */
  list(): Service[];
  /** O serviço pelo número da lista (1 a N), ou null */
  byNumber(n: number): string | null;
  /** Como o serviço aparece ao cliente, na língua pedida; um serviço fixo sai com o rótulo dele mesmo fora da lista */
  label(name: string, language?: Language): string;
  /** O serviço cujo rótulo (ou nome) é este texto, sem acento nem caixa; null se nenhum. Só entre os oferecidos. */
  byLabel(text: string): string | null;
  /** Os serviços para a lista do painel */
  panelList(): Service[];
  /** O tempo do serviço na agenda, ou undefined para a duração padrão */
  minutes(name: string): number | undefined;
}

/** Minúsculas, sem acento, e pontuação vira espaço: o que um rótulo e o texto do cliente têm em comum. */
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** O rótulo de um serviço fixo na língua pedida, ou undefined para um tratamento */
export const fixedLabel = (name: string, language: Language): string | undefined => FIXED_LABELS.get(name)?.[language];

/** Serviço fixo (avaliação, retorno): a nota guarda a chave e quem mostra traduz; o tratamento guarda o próprio título */
export const isFixedService = (name: string): boolean => FIXED_LABELS.has(name);

/** O tempo de um serviço fixo, mesmo quando ele não é oferecido: o que a clínica configurou (o padrão é undefined) */
function fixedMinutes(name: string, offers: ServiceOffers): number | undefined {
  if (name === ASSESSMENT) return offers.assessmentMinutes ?? undefined;
  if (name === FOLLOW_UP) return offers.followUpMinutes ?? undefined;
  return undefined;
}

/** `minutes` só quando há um valor: a ausência de tempo é a duração padrão, não uma propriedade com undefined */
const timed = (minutes: number | null): { minutes?: number } => (minutes ? { minutes } : {});

/** O catálogo a partir dos tratamentos e dos serviços fixos oferecidos: o retorno e a avaliação entram no fim, nessa ordem. */
export function createCatalog(treatments: Service[], offers: ServiceOffers = DEFAULT_OFFERS): ServiceCatalog {
  const services: Service[] = [
    ...treatments,
    ...(offers.offerFollowUp ? [{ name: FOLLOW_UP, label: FIXED_LABELS.get(FOLLOW_UP)!.en, ...timed(offers.followUpMinutes) }] : []),
    ...(offers.offerAssessment ? [{ name: ASSESSMENT, label: FIXED_LABELS.get(ASSESSMENT)!.en, ...timed(offers.assessmentMinutes) }] : []),
  ];
  const byText = new Map<string, string>();
  for (const s of services) {
    const fixed = FIXED_LABELS.get(s.name);
    const texts = [s.name, s.label, ...(fixed ? Object.values(fixed) : [])];
    for (const text of texts) byText.set(normalize(text), s.name);
  }
  return {
    list: () => [...services],
    byNumber: (n) => services[n - 1]?.name ?? null,
    label: (name, language = "en") => fixedLabel(name, language) ?? services.find((s) => s.name === name)?.label ?? name,
    byLabel: (text) => byText.get(normalize(text)) ?? null,
    panelList: () => [...services],
    minutes: (name) => services.find((s) => s.name === name)?.minutes ?? fixedMinutes(name, offers),
  };
}

export interface KnowledgeCatalog extends ServiceCatalog {
  /** Relê a tabela de conhecimento e troca os tratamentos: no boot e depois de cada mudança no painel */
  refresh(): Promise<void>;
}

/**
 * Os tratamentos que o cliente pode marcar são as seções de tratamento da tabela de conhecimento, sem `bookable: false`,
 * na ordem da posição (ADR 0014). O nome guardado é a chave da seção; o rótulo é o título. Os serviços fixos são lidos da
 * clínica a cada chamada: a troca no painel (Folheto > Clínica) vale na mensagem seguinte, sem reinício.
 */
export function createKnowledgeCatalog({ repo, clinic }: { repo: Pick<KnowledgeRepository, "list">; clinic: ServiceOffers }): KnowledgeCatalog {
  let treatments: Service[] = [];
  const current = () => createCatalog(treatments, clinic);
  return {
    list: () => current().list(),
    byNumber: (n) => current().byNumber(n),
    label: (name, language) => current().label(name, language),
    byLabel: (text) => current().byLabel(text),
    panelList: () => current().panelList(),
    minutes: (name) => current().minutes(name),
    async refresh() {
      const rows = await repo.list();
      treatments = rows.filter(isBookable).map((row) => ({
        name: row.key,
        label: row.title,
        ...(row.kind === "treatment" && row.data.appointmentMinutes ? { minutes: row.data.appointmentMinutes } : {}),
      }));
    },
  };
}
