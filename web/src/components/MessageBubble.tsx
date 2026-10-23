import type { Message } from "../api";
import { formatDateTime, formatTime, mediaLabel, originLabel } from "../format";

const STATUS_ICON: Record<Message["status"], string> = { received: "", sending: "⏳", sent: "✓", failed: "⚠️", blocked: "🛡️" };

/** Por que a proteção do número não enviou (specs/004-whatsapp-anti-ban/data-model.md). */
const BLOCK_REASONS: Record<string, string> = {
  outside_window: "o cliente não escreve há mais de 24 h",
  rate_limited: "ficou tempo demais na fila",
  daily_conversations: "limite diário de conversas atingido",
  unanswered: "muitas mensagens seguidas sem resposta do cliente",
  loop: "possível conversa com outro robô",
  duplicate: "texto repetido",
  opted_out: "o cliente pediu para não receber mensagens",
  paused: "envios automáticos pausados pela proteção",
  restart: "servidor reiniciado antes do envio",
  superseded: "o operador respondeu antes",
};

export function MessageBubble({ message, onRetry }: { message: Message; onRetry?: (m: Message) => void }) {
  const label = mediaLabel(message.type);
  const mine = message.origin !== "customer";

  // Registro do Secretaryfy (ex.: agendamento feito pelo assistente): linha centralizada, sem balão
  if (message.origin === "system") {
    return (
      <div className="system-note" title={formatDateTime(message.sentAt)}>
        {message.text} · {formatTime(message.sentAt)}
      </div>
    );
  }

  return (
    <div className={`bubble-row ${mine ? "mine" : "theirs"}`}>
      <div className={`bubble origin-${message.origin} ${message.status === "failed" || message.status === "blocked" ? message.status : ""}`}>
        <span className="origin">{originLabel(message.origin)}</span>
        {label && <span className="media">{label}</span>}
        {message.text && <p className="text">{message.text}</p>}
        <span className="meta" title={formatDateTime(message.sentAt)}>
          {formatTime(message.sentAt)}
          {STATUS_ICON[message.status] && (
            <span className="status" title={message.error ?? undefined}>
              {" "}
              {STATUS_ICON[message.status]}
            </span>
          )}
        </span>
        {message.status === "failed" && (
          <span className="failed-actions">
            Não enviada{message.error ? `: ${message.error}` : ""}
            {message.origin === "operator" && onRetry && (
              <button className="link" onClick={() => onRetry(message)}>
                Tentar de novo
              </button>
            )}
          </span>
        )}
        {message.status === "blocked" && (
          <span className="blocked-reason">
            Não enviada pela proteção: {(message.error && BLOCK_REASONS[message.error]) ?? message.error}
          </span>
        )}
      </div>
    </div>
  );
}
