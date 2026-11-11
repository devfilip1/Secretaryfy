import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { applyTheme, readStoredTheme, THEME_CHOICES, writeStoredTheme, type ThemeChoice } from "./theme";

const ICONS: Record<ThemeChoice, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

/** Seletor do tema do painel: no cabeçalho e na tela de login, ao lado do idioma. */
export function ThemeSelect({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ThemeChoice>(() => readStoredTheme() ?? "system");
  const Icon = ICONS[choice];

  function choose(value: string) {
    const next = THEME_CHOICES.find((option) => option === value);
    if (!next) return;
    writeStoredTheme(next);
    applyTheme(next);
    setChoice(next);
  }

  return (
    <Select value={choice} onValueChange={choose}>
      <SelectTrigger aria-label={t("theme.label")} className={cn("w-auto gap-1.5 px-2", className)}>
        <Icon aria-hidden />
        <SelectValue>
          {/* Só o ícone, até a barra lateral da etapa 2 tirar o seletor do cabeçalho apertado */}
          <span className="hidden 2xl:inline">{t(`theme.${choice}`)}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {THEME_CHOICES.map((option) => {
          const OptionIcon = ICONS[option];
          return (
            <SelectItem key={option} value={option}>
              <OptionIcon aria-hidden />
              {t(`theme.${option}`)}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
