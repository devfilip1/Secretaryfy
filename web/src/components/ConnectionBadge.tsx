import type { Connection } from "../api";
import { formatPhone } from "../format";

export function ConnectionBadge({ connection }: { connection: Connection | null }) {
  if (!connection) return <span className="badge">…</span>;
  if (connection.state === "open") {
    return (
      <span className="badge ok" title={connection.number ? `WhatsApp connected · ${formatPhone(connection.number)}` : "WhatsApp connected"}>
        ● Connected
        {/* No celular o número some para a barra caber numa linha; fica no title */}
        {connection.number && <span className="badge-number"> · {formatPhone(connection.number)}</span>}
      </span>
    );
  }
  return (
    <a href="#/connection" className={`badge ${connection.state === "connecting" ? "warn" : "bad"}`}>
      ● {connection.state === "connecting" ? "Connecting…" : "Disconnected"}
    </a>
  );
}
