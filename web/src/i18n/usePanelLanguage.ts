import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getClinicSettings } from "../api";
import { setPanelLanguage } from "./index";
import { isPanelLanguage, readStoredLanguage, writeStoredLanguage, type PanelLanguage } from "./language";

/** O idioma que o painel mostra agora. As leituras com rótulos (serviços, agenda, clientes) pedem nele. */
export function useActivePanelLanguage(): PanelLanguage {
  const { i18n } = useTranslation();
  return isPanelLanguage(i18n.language) ? i18n.language : "en";
}

/**
 * Idioma do painel para o App. Com a sessão pronta e sem escolha guardada, aplica o idioma da clínica
 * (uma leitura). Erro é ignorado de propósito: o painel segue no idioma que já escolheu pelo navegador.
 */
export function usePanelLanguage(ready: boolean): [PanelLanguage, (language: PanelLanguage) => void] {
  const language = useActivePanelLanguage();

  useEffect(() => {
    if (!ready || readStoredLanguage() !== undefined) return;
    let cancelled = false;
    getClinicSettings()
      .then((settings) => {
        // Se o operador escolheu enquanto a leitura andava, a escolha dele vence
        if (cancelled || readStoredLanguage() !== undefined || !isPanelLanguage(settings.language)) return;
        setPanelLanguage(settings.language);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const change = (next: PanelLanguage) => {
    writeStoredLanguage(next);
    setPanelLanguage(next);
  };

  return [language, change];
}
