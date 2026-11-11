import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { NavItem } from "../nav";
import { NAV_ICONS } from "./nav-icons";

/** Um destino da barra lateral: ícone de 20 px sobre o rótulo, num link de 60 px. Ativo: fundo rail-on e texto branco. */
export function RailLink({ item, active, badge = 0 }: { item: NavItem; active: boolean; badge?: number }) {
  const { t } = useTranslation();
  const Icon = NAV_ICONS[item.view];

  return (
    <a
      href={item.hash}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-[60px] w-[72px] flex-col items-center justify-center gap-1 rounded-lg text-[11.5px] leading-tight no-underline transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        active ? "bg-rail-on text-white" : "text-rail-ink hover:bg-rail-on/60 hover:text-white",
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <span className="whitespace-nowrap">{t(item.shortKey)}</span>
      {badge > 0 && (
        <span
          role="img"
          aria-label={t("nav.attentionCount", { count: badge })}
          className="absolute top-1 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white"
        >
          {badge}
        </span>
      )}
    </a>
  );
}
