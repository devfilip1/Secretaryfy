// Idioma do painel (en ou pt), independente do idioma do assistente. Funções puras e acesso ao localStorage à prova de falhas.

export type PanelLanguage = "en" | "pt";

export const PANEL_LANGUAGES: readonly PanelLanguage[] = ["en", "pt"];

/** Cada idioma com o próprio nome: nunca traduzido. */
export const PANEL_LANGUAGE_NAMES: Readonly<Record<PanelLanguage, string>> = { en: "English", pt: "Português" };

/** Chave do localStorage com a escolha feita no painel. */
const STORAGE_KEY = "secretaryfy.panelLanguage";

/** O que usamos do Storage; o teste injeta um objeto que falha. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isPanelLanguage(value: unknown): value is PanelLanguage {
  return value === "en" || value === "pt";
}

/** pt, pt-BR e afins viram pt; qualquer outro idioma do navegador vira en. */
export function languageFromBrowser(tag: string | undefined): PanelLanguage {
  return tag?.toLowerCase().split("-")[0] === "pt" ? "pt" : "en";
}

/** Ordem: escolha guardada no navegador, depois idioma da clínica, depois idioma do navegador. Valores inválidos são ignorados. */
export function resolvePanelLanguage({
  stored,
  clinic,
  browser,
}: {
  stored?: unknown;
  clinic?: unknown;
  browser?: string;
}): PanelLanguage {
  if (isPanelLanguage(stored)) return stored;
  if (isPanelLanguage(clinic)) return clinic;
  return languageFromBrowser(browser);
}

/** localStorage pode estar bloqueado (modo privado, política do navegador): sem acesso, não há escolha guardada. */
function storageOf(given?: KeyValueStorage): KeyValueStorage | undefined {
  if (given) return given;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Escolha guardada pelo operador, ou undefined. Nunca lança. */
export function readStoredLanguage(storage?: KeyValueStorage): PanelLanguage | undefined {
  try {
    const value = storageOf(storage)?.getItem(STORAGE_KEY);
    return isPanelLanguage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Guarda a escolha do operador. Se o armazenamento falhar, a escolha vale só nesta aba. Nunca lança. */
export function writeStoredLanguage(language: PanelLanguage, storage?: KeyValueStorage): void {
  try {
    storageOf(storage)?.setItem(STORAGE_KEY, language);
  } catch {
    // armazenamento bloqueado: o painel segue no idioma atual
  }
}
