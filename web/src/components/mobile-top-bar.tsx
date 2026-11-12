import type { Connection } from "../api";
import { AccountMenu } from "./account-menu";
import { ConnectionBadge } from "./ConnectionBadge";
import { ToothIcon } from "./tooth-icon";

/** Barra superior do celular: marca à esquerda; estado da conexão e conta à direita. A navegação fica na barra de baixo. */
export function MobileTopBar({ connection, onSignOut }: { connection: Connection | null; onSignOut: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--rail)]">
        <ToothIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate font-bold">Secretaryfy</span>
      <ConnectionBadge connection={connection} compact />
      <AccountMenu onSignOut={onSignOut} />
    </header>
  );
}
