import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { setPanelLanguage } from "./index";
import { isPanelLanguage, PANEL_LANGUAGES, writeStoredLanguage, type PanelLanguage } from "./language";

/** Cada idioma com o próprio nome: nunca traduzido. */
export const NATIVE_NAMES: Record<PanelLanguage, string> = { en: "English", pt: "Português" };

/** Guarda a escolha e troca o idioma do painel. Valores fora de en/pt são ignorados. Usado pelo seletor e pelo menu da conta. */
export function choosePanelLanguage(value: string): void {
  if (!isPanelLanguage(value)) return;
  writeStoredLanguage(value);
  setPanelLanguage(value);
}

/** Seletor do idioma do painel: na tela de login (é a única forma de trocar antes de entrar). Logado, fica no menu da conta. */
export function PanelLanguage({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const current: PanelLanguage = isPanelLanguage(i18n.language) ? i18n.language : "en";

  return (
    <Select value={current} onValueChange={choosePanelLanguage}>
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
