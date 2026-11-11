import { useTranslation } from "react-i18next";
import type { Connection } from "../api";
import { formatPhone } from "../format";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Estado da conexão do WhatsApp: ponto colorido e texto (com o número, quando conectado).
 * `compact` mostra só o ponto, como link para a tela de conexão (celular). Na barra lateral a linha
 * usa o mesmo eixo dos ícones; recolhida, sobra só o ponto centralizado e o estado completo vai na dica ao lado.
 */
export function ConnectionBadge({ connection, compact = false }: { connection: Connection | null; compact?: boolean }) {
  const { t } = useTranslation();
  const { state: sidebarState } = useSidebar();
  const open = connection?.state === "open";
  const phone = connection?.state === "open" && connection.number ? formatPhone(connection.number) : null;

  const tone = !connection
    ? "text-muted-foreground"
    : connection.state === "open"
      ? "text-ok"
      : connection.state === "connecting"
        ? "text-warn"
        : "text-destructive";
  const text = !connection
    ? "…"
    : connection.state === "open"
      ? t("connection.connected")
      : connection.state === "connecting"
        ? t("connection.connecting")
        : t("connection.disconnected");
  // No título fica o número inteiro, mesmo quando o texto não o mostra
  const title = open ? (phone ? t("connection.titleNumber", { phone }) : t("connection.title")) : text;
  const linkToConnection = !open;

  if (compact) {
    return (
      <a href="#/connection" title={title} aria-label={title} className={cn("flex size-9 items-center justify-center no-underline", tone)}>
        <span aria-hidden className="size-2.5 rounded-full bg-current" />
      </a>
    );
  }

  // A cor de estado vai só no ponto; o texto fica em cinza, como o resto da barra
  const body = (
    <>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full bg-current group-data-[collapsible=icon]:size-2.5", tone)} />
      <span className="truncate group-data-[collapsible=icon]:hidden">
        {text}
        {phone && ` · ${phone}`}
      </span>
    </>
  );
  const rowClass =
    "flex h-10 min-w-0 items-center gap-2 px-3 text-xs text-muted-foreground no-underline group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0";
  // Desconectado ou conectando: a linha leva para a tela de conexão, onde se reconecta
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {linkToConnection ? (
          <a href="#/connection" aria-label={title} className={rowClass}>
            {body}
          </a>
        ) : (
          <div aria-label={title} className={rowClass}>
            {body}
          </div>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" hidden={sidebarState !== "collapsed"}>
        {title}
      </TooltipContent>
    </Tooltip>
  );
}
