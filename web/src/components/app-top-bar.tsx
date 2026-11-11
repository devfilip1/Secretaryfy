import { useTranslation } from "react-i18next";
import type { Connection } from "../api";
import { navItemFor, type View } from "../nav";
import { AccountMenu } from "./account-menu";
import { Brand } from "./brand";
import { ConnectionBadge } from "./ConnectionBadge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Barra de cima do desktop, dentro do conteúdo: botão que abre e recolhe a barra lateral, a tela atual e um espaço à direita para ações da página.
 * O botão não tem contorno fixo; o anel de foco aparece só no foco pelo teclado.
 */
export function AppTopBar({ view }: { view: View }) {
  const { t } = useTranslation();

  return (
    <header className="hidden h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4 md:flex">
      <SidebarTrigger
        aria-label={t("toggleSidebar")}
        className="size-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
      />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="text-sm font-medium">{t(navItemFor(view).labelKey)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2" />
    </header>
  );
}

/** Barra de cima do celular: marca, bolinha da conexão e menu da conta. Não há barra lateral no celular. */
export function MobileTopBar({ connection, onSignOut }: { connection: Connection | null; onSignOut: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4 md:hidden">
      <Brand />
      <div className="flex items-center gap-1">
        <ConnectionBadge connection={connection} compact />
        <AccountMenu variant="compact" onSignOut={onSignOut} />
      </div>
    </header>
  );
}
