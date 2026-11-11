import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "../api";
import { NAV_GROUPS, navItemsIn, type View } from "../nav";
import { AccountMenu } from "./account-menu";
import { Brand } from "./brand";
import { ConnectionBadge } from "./ConnectionBadge";
import { NAV_ICONS } from "./nav-icons";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Botão de destino. Aberta: linha de 40 px com ícone de 20 px. Recolhida: quadrado de 40 px centralizado.
 * O destino atual leva um fundo de cor da marca bem leve, ícone na cor da marca e texto em negrito.
 * `data-[active=true]:` sobrepõe as classes que o componente da sidebar põe para o estado ativo.
 */
const NAV_BUTTON_CLASS = [
  "h-10 gap-3 px-3 text-muted-foreground hover:bg-secondary hover:text-foreground",
  "[&>svg]:size-5",
  "data-[active=true]:bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] data-[active=true]:font-medium data-[active=true]:text-foreground data-[active=true]:[&>svg]:text-primary",
  "group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!",
].join(" ");

/** Barra lateral do desktop (md para cima): navegação por grupos, conexão e conta. Recolhe para ícones (Ctrl/Cmd+B). */
export function AppSidebar({
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
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-12 flex-row items-center border-b border-border p-0 px-5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <Brand sidebar />
      </SidebarHeader>
      <SidebarContent className="gap-0 group-data-[collapsible=icon]:py-2">
        {NAV_GROUPS.map((group, index) => (
          <Fragment key={group.id}>
            {/* Recolhida, o separador faz o papel dos títulos dos grupos */}
            {index > 0 && <div aria-hidden className="mx-auto my-3 hidden h-px w-6 bg-border group-data-[collapsible=icon]:block" />}
            <SidebarGroup className="mt-4 first:mt-0 group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:py-0">
              <SidebarGroupLabel className="px-3 text-muted-foreground group-data-[collapsible=icon]:hidden">{t(group.labelKey)}</SidebarGroupLabel>
              <SidebarMenu>
                {navItemsIn(group.id).map((item) => {
                  const Icon = NAV_ICONS[item.view];
                  const active = view === item.view;
                  return (
                    <SidebarMenuItem key={item.view}>
                      <SidebarMenuButton asChild isActive={active} tooltip={t(item.labelKey)} className={NAV_BUTTON_CLASS}>
                        <a href={item.hash} aria-current={active ? "page" : undefined}>
                          <Icon aria-hidden />
                          <span>{t(item.labelKey)}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          </Fragment>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-border">
        <ConnectionBadge connection={connection} />
        <AccountMenu variant="sidebar" onSignOut={onSignOut} />
      </SidebarFooter>
    </Sidebar>
  );
}
