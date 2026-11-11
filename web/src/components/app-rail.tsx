import { useTranslation } from "react-i18next";
import { navItemsAt, type View } from "../nav";
import { RailLink } from "./rail-link";
import { ToothIcon } from "./tooth-icon";

/** Barra lateral do md para cima: marca no topo, destinos empilhados e Conexão e Agenda embaixo. Rótulos sempre visíveis. */
export function AppRail({ view, attentionCount }: { view: View; attentionCount: number }) {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("nav.label")} className="hidden w-[84px] shrink-0 flex-col items-center gap-1 bg-rail py-3 text-rail-ink md:flex">
      <span aria-hidden className="mb-3 flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--rail)]">
        <ToothIcon className="size-[21px]" />
      </span>
      {navItemsAt("top").map((item) => (
        <RailLink key={item.hash} item={item} active={view === item.view} badge={item.view === "inbox" ? attentionCount : 0} />
      ))}
      <div className="mt-auto flex flex-col items-center gap-1">
        {navItemsAt("bottom").map((item) => (
          <RailLink key={item.hash} item={item} active={view === item.view} />
        ))}
      </div>
    </nav>
  );
}
