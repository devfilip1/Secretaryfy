import { useTranslation } from "react-i18next";
import type { Connection } from "../api";
import { formatPhone } from "../format";
import { Badge } from "@/components/ui/badge";

export function ConnectionBadge({ connection }: { connection: Connection | null }) {
  const { t } = useTranslation();
  if (!connection) return <Badge variant="secondary">…</Badge>;
  if (connection.state === "open") {
    const title = connection.number
      ? t("connection.titleNumber", { phone: formatPhone(connection.number) })
      : t("connection.title");
    return (
      <Badge variant="secondary" className="text-ok" title={title}>
        ● {t("connection.connected")}
        {/* No celular o número some para a barra caber numa linha; fica no title */}
        {connection.number && <span className="max-xl:hidden">· {formatPhone(connection.number)}</span>}
      </Badge>
    );
  }
  return (
    <Badge asChild variant="secondary" className={connection.state === "connecting" ? "text-warn" : "text-destructive"}>
      <a href="#/connection">
        ● {connection.state === "connecting" ? t("connection.connecting") : t("connection.disconnected")}
      </a>
    </Badge>
  );
}
