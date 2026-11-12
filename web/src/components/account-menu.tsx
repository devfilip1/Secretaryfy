import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { setPanelLanguage } from "../i18n";
import { isPanelLanguage, PANEL_LANGUAGE_NAMES, PANEL_LANGUAGES, writeStoredLanguage, type PanelLanguage } from "../i18n/language";
import { applyTheme, readStoredTheme, THEME_CHOICES, writeStoredTheme, type ThemeChoice } from "../theme/theme";
import { clinicSettingsQuery } from "../queries";
import { clinicInitials } from "./clinic-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Menu da conta (canto direito da barra de cima): tema, idioma e sair. Substitui o seletor de tema, o de idioma e o "Sair" do cabeçalho antigo. */
export function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<ThemeChoice>(() => readStoredTheme() ?? "system");
  const language: PanelLanguage = isPanelLanguage(i18n.language) ? i18n.language : "en";
  // Login único por clínica: o cabeçalho e o avatar mostram o nome da clínica; enquanto carrega ou em erro, texto neutro.
  const clinic = useQuery(clinicSettingsQuery());
  const clinicName = clinic.data?.name.trim() || null;
  const initials = clinicInitials(clinic.data?.name) ?? t("account.initialsFallback");

  function chooseTheme(value: string) {
    const next = THEME_CHOICES.find((option) => option === value);
    if (!next) return;
    writeStoredTheme(next);
    applyTheme(next);
    setTheme(next);
  }

  function chooseLanguage(value: string) {
    if (!isPanelLanguage(value)) return;
    writeStoredLanguage(value);
    setPanelLanguage(value);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("account.menu")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{clinicName ?? t("account.title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("account.theme")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={chooseTheme}>
          {THEME_CHOICES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {t(`theme.${option}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("account.language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={language} onValueChange={chooseLanguage}>
          {PANEL_LANGUAGES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {PANEL_LANGUAGE_NAMES[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>{t("signOut")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
