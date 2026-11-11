import { ChevronsUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { isPanelLanguage, PANEL_LANGUAGES } from "../i18n/language";
import { choosePanelLanguage, NATIVE_NAMES } from "../i18n/PanelLanguage";

/** Iniciais do avatar da equipe: o painel tem uma só conta. */
const TEAM_INITIALS = "SF";

/** Menu da conta: idioma do painel e sair. Na barra lateral o gatilho traz o avatar e "Team"; no celular, só o avatar. */
export function AccountMenu({ variant, onSignOut }: { variant: "sidebar" | "compact"; onSignOut: () => void }) {
  const { t, i18n } = useTranslation();
  const current = isPanelLanguage(i18n.language) ? i18n.language : "en";
  const avatar = (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground",
        variant === "sidebar" ? "size-8 text-xs" : "size-7 text-xs",
      )}
    >
      {TEAM_INITIALS}
    </span>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "sidebar" ? (
          <SidebarMenuButton
            aria-label={t("accountMenu")}
            className="h-10 gap-3 px-3 hover:bg-secondary group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
          >
            {avatar}
            <span className="flex-1 truncate text-left font-medium group-data-[collapsible=icon]:hidden">{t("team")}</span>
            <ChevronsUpDown aria-hidden className="ml-auto text-muted-foreground group-data-[collapsible=icon]:hidden" />
          </SidebarMenuButton>
        ) : (
          <Button variant="ghost" size="icon" className="size-9 rounded-full p-0" aria-label={t("accountMenu")}>
            {avatar}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={variant === "sidebar" ? "right" : "bottom"} align="end" className="min-w-48">
        <DropdownMenuLabel>{t("accountMenu")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("panelLanguage")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={choosePanelLanguage}>
          {PANEL_LANGUAGES.map((language) => (
            <DropdownMenuRadioItem key={language} value={language}>
              {NATIVE_NAMES[language]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>{t("signOut")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
