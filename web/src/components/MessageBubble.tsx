import type { Message } from "../api";
import { blockReasonText, formatDateTime, formatTime, mediaLabel, originLabel } from "../format";

const STATUS_ICON: Record<Message["status"], string> = { received: "", sending: "⏳", sent: "✓", failed: "⚠️", blocked: "🛡️" };

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
            Not sent{message.error ? `: ${message.error}` : ""}
            {message.origin === "operator" && onRetry && (
              <button className="link" onClick={() => onRetry(message)}>
                Try again
              </button>
            )}
          </span>
        )}
        {message.status === "blocked" && (
          <span className="blocked-reason">
            Not sent by protection: {blockReasonText(message.error)}
          </span>
        )}
      </div>
    </div>
  );
}
