import type { Connection } from "../api";
import { formatPhone } from "../format";
import { Badge } from "@/components/ui/badge";

export function ConnectionBadge({ connection }: { connection: Connection | null }) {
  if (!connection) return <Badge variant="secondary">…</Badge>;
  if (connection.state === "open") {
    return (
      <Badge
        variant="secondary"
        className="text-ok"
        title={connection.number ? `WhatsApp connected · ${formatPhone(connection.number)}` : "WhatsApp connected"}
      >
        ● Connected
        {/* No celular o número some para a barra caber numa linha; fica no title */}
        {connection.number && <span className="max-xl:hidden">· {formatPhone(connection.number)}</span>}
      </Badge>
    );
  }
  return (
    <Badge asChild variant="secondary" className={connection.state === "connecting" ? "text-warn" : "text-destructive"}>
      <a href="#/connection">● {connection.state === "connecting" ? "Connecting…" : "Disconnected"}</a>
    </Badge>
  );
}
