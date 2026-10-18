import type { Connection } from "../api";
import { formatPhone } from "../format";

export function ConnectionBadge({ connection }: { connection: Connection | null }) {
  if (!connection) return <span className="badge">…</span>;
  if (connection.state === "open") {
    return (
      <span className="badge ok" title="WhatsApp conectado">
        ● Conectado{connection.number ? ` · ${formatPhone(connection.number)}` : ""}
      </span>
    );
  }
  return (
    <a href="#/conexao" className={`badge ${connection.state === "connecting" ? "warn" : "bad"}`}>
      ● {connection.state === "connecting" ? "Conectando…" : "Desconectado"}
    </a>
  );
}
