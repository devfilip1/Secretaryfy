import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { clinicFormats } from "../format";

/** Locale do Intl para cada idioma do painel. */
export function localeOf(language: string): "en-US" | "pt-BR" {
  return language === "pt" ? "pt-BR" : "en-US";
}

/** Formatadores de dia e hora da clínica no idioma atual do painel. */
export function useFormats(timeZone?: string) {
  const { i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  return useMemo(() => clinicFormats(timeZone, locale), [timeZone, locale]);
}
