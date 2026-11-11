import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { readStoredLanguage, resolvePanelLanguage, type PanelLanguage } from "./language";

// Todos os locales/<idioma>/<namespace>.json, carregados no build: nada vai pela rede.
const files = import.meta.glob("../locales/*/*.json", { eager: true, import: "default" }) as Record<
  string,
  Record<string, unknown>
>;

/** Os namespaces de um idioma: { common: {...}, login: {...} }. */
function bundlesOf(language: PanelLanguage): Record<string, Record<string, unknown>> {
  const bundles: Record<string, Record<string, unknown>> = {};
  for (const [path, content] of Object.entries(files)) {
    const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (match?.[1] === language && match[2]) bundles[match[2]] = content;
  }
  return bundles;
}

const initial = resolvePanelLanguage({ stored: readStoredLanguage(), browser: globalThis.navigator?.language });

void i18n.use(initReactI18next).init({
  resources: { en: bundlesOf("en"), pt: bundlesOf("pt") },
  lng: initial,
  fallbackLng: "en",
  defaultNS: "common",
  // Os namespaces são os arquivos do inglês: uma tela nova só cria o seu json
  ns: Object.keys(bundlesOf("en")),
  interpolation: { escapeValue: false },
  initAsync: false,
});
document.documentElement.lang = initial;

/** Troca o idioma do painel e o atributo lang do documento. Não grava a escolha: quem chama decide. */
export function setPanelLanguage(language: PanelLanguage): void {
  document.documentElement.lang = language;
  void i18n.changeLanguage(language);
}

export default i18n;
