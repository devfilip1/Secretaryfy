import { useTranslation } from "react-i18next";
import type { Connection } from "../api";
import { navItemFor, type View } from "../nav";
import { AccountMenu } from "./account-menu";
import { ConnectionBadge } from "./ConnectionBadge";

/** Barra superior do desktop: nome da tela à esquerda; conexão e conta à direita. */
export function AppTopBar({
  view,
  connection,
  onSignOut,
}: {
  view: View;
  connection: Connection | null;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();

  return (
    <header className="hidden h-12 shrink-0 items-center gap-4 border-b border-border bg-card px-6 md:flex">
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{t(navItemFor(view).shortKey)}</p>
      <ConnectionBadge connection={connection} />
      <AccountMenu onSignOut={onSignOut} />
    </header>
  );
}
