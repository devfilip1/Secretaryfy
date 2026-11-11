import { useTranslation } from "react-i18next";
import { NAV_ITEMS, type View } from "../nav";
import { NAV_ICONS } from "./nav-icons";

/** Link da barra de baixo: ícone sobre o texto curto, uma célula de 1/6 da largura. */
function navLinkClass(active: boolean): string {
  const state = active ? "border-primary text-primary" : "border-transparent text-muted-foreground";
  return `${state} flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 border-t-2 text-[11px] leading-tight no-underline`;
}

/** Barra de baixo do celular (abaixo de md). Os destinos vêm de nav.ts, os mesmos da barra lateral. */
export function MobileTabBar({ view }: { view: View }) {
  const { t } = useTranslation();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
      {NAV_ITEMS.map(({ shortKey, hash, view: target }) => {
        const Icon = NAV_ICONS[target];
        const active = view === target;
        return (
          <a key={hash} href={hash} className={navLinkClass(active)} aria-current={active ? "page" : undefined}>
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="max-w-full truncate">{t(shortKey)}</span>
          </a>
        );
      })}
    </nav>
  );
}
