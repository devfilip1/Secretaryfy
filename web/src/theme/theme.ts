// Tema do painel: sistema, claro ou escuro. Funções puras; o acesso ao localStorage é à prova de falhas.
import type { KeyValueStorage } from "../i18n/language";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** Chave do localStorage com a escolha feita no painel (o script do index.html usa a mesma). */
const STORAGE_KEY = "secretaryfy.theme";

/** Só o que usamos da raiz do documento; o teste injeta um objeto simples. */
export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
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
export function readStoredTheme(storage?: KeyValueStorage): ThemeChoice | undefined {
  try {
    const value = storageOf(storage)?.getItem(STORAGE_KEY);
    return isThemeChoice(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Guarda a escolha do operador. Se o armazenamento falhar, a escolha vale só nesta aba. Nunca lança. */
export function writeStoredTheme(choice: ThemeChoice, storage?: KeyValueStorage): void {
  try {
    storageOf(storage)?.setItem(STORAGE_KEY, choice);
  } catch {
    // armazenamento bloqueado: o painel segue no tema atual
  }
}

/** Aplica a escolha na raiz: data-theme "light" ou "dark"; sem atributo, o sistema decide (ver tailwind.css). */
export function applyTheme(choice: ThemeChoice, root: ThemeRoot = document.documentElement): void {
  if (choice === "system") {
    root.removeAttribute("data-theme");
    return;
  }
  root.setAttribute("data-theme", choice);
}
