import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { clinicFormats } from "../format";
import { createFormats, type PanelLocale } from "./createFormats";

/** Locale do Intl para cada idioma do painel. */
export function localeOf(language: string): PanelLocale {
  return language === "pt" ? "pt-BR" : "en-US";
}

/** Formatadores no fuso da clínica e no idioma atual do painel: day/time e as funções formatX (createFormats). */
export function useFormats(timeZone?: string) {
  const { i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  return useMemo(
    () => ({ ...clinicFormats(timeZone, locale), ...createFormats(locale, timeZone) }),
    [timeZone, locale],
  );
}
