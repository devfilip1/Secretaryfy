import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { setPanelLanguage } from "./index";
import { isPanelLanguage, PANEL_LANGUAGES, writeStoredLanguage, type PanelLanguage } from "./language";

/** Cada idioma com o próprio nome: nunca traduzido. */
const NATIVE_NAMES: Record<PanelLanguage, string> = { en: "English", pt: "Português" };

/** Seletor do idioma do painel: no cabeçalho e na tela de login (é a única forma de trocar antes de entrar). */
export function PanelLanguage({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const current: PanelLanguage = isPanelLanguage(i18n.language) ? i18n.language : "en";

  function choose(value: string) {
    if (!isPanelLanguage(value)) return;
    writeStoredLanguage(value);
    setPanelLanguage(value);
  }

  return (
    <Select value={current} onValueChange={choose}>
      <SelectTrigger aria-label={t("panelLanguage")} className={cn("w-auto gap-1.5 px-2", className)}>
        <Globe aria-hidden />
        <SelectValue>
          <span className="sm:hidden">{current.toUpperCase()}</span>
          <span className="hidden sm:inline">{NATIVE_NAMES[current]}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PANEL_LANGUAGES.map((language) => (
          <SelectItem key={language} value={language}>
            {NATIVE_NAMES[language]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
