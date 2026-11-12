import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "../api";
import { formatPhone } from "../format";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "bad" | "muted";

const DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-destructive", muted: "bg-muted-foreground" };
const TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-destructive", muted: "text-muted-foreground" };

/** Estado da conexão do WhatsApp: ponto colorido e texto curto, nas barras de cima. No celular (compact) só o ponto; o texto fica para leitores de tela. */
export function ConnectionBadge({ connection, compact = false }: { connection: Connection | null; compact?: boolean }) {
  const { t } = useTranslation();
  if (!connection) return <Status tone="muted" text="…" compact={compact} />;

  if (connection.state === "open") {
    const title = connection.number
      ? t("connection.titleNumber", { phone: formatPhone(connection.number) })
      : t("connection.title");
    // No desktop o número aparece só em telas largas; no celular fica no title
    const number =
      connection.number && !compact ? <span className="max-xl:hidden">· {formatPhone(connection.number)}</span> : undefined;
    return <Status tone="ok" text={t("connection.connected")} title={title} compact={compact} extra={number} />;
  }

  const connecting = connection.state === "connecting";
  return (
    <Status
      tone={connecting ? "warn" : "bad"}
      text={connecting ? t("connection.connecting") : t("connection.disconnected")}
      href="#/connection"
      compact={compact}
    />
  );
}

function Status({
  tone,
  text,
  title,
  href,
  compact,
  extra,
}: {
  tone: Tone;
  text: string;
  title?: string;
  href?: string;
  compact: boolean;
  extra?: ReactNode;
}) {
  const content = (
    <>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      <span className={compact ? "sr-only" : "truncate"}>{text}</span>
      {extra}
    </>
  );
  const className = cn(
    "inline-flex min-w-0 items-center gap-1.5 text-xs font-medium no-underline",
    TEXT[tone],
    href && "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
  );

  if (href) {
    return (
      <a href={href} title={title} className={className}>
        {content}
      </a>
    );
  }
  return (
    <span title={title} className={className}>
      {content}
    </span>
  );
}
