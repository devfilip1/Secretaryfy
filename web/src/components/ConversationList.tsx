import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../api";
import { formatPhone, formatTime } from "../format";

const DEBOUNCE_MS = 250;

export function ConversationList({
  conversations,
  loaded,
  selectedId,
  onSelect,
  onSearch,
}: {
  conversations: Conversation[];
  loaded: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSearch: (q: string) => void;
}) {
  const [q, setQ] = useState("");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => onSearch(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <aside className="conversation-list">
      <input
        className="search"
        type="search"
        placeholder="Buscar por nome ou número"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul>
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              className={`conversation ${c.id === selectedId ? "selected" : ""} ${c.needsAttention ? "attention" : ""}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="row">
                <span className="name">
                  {c.assistantPaused && (
                    <span className="paused-icon" title="Assistente pausado">
                      ⏸{" "}
                    </span>
                  )}
                  {c.name || formatPhone(c.phone)}
                </span>
                <span className="time">{formatTime(c.lastMessageAt)}</span>
              </span>
              <span className="row">
                <span className="preview">
                  {c.needsAttention && <span className="attention-tag">Precisa de atendimento</span>}
                  {c.lastMessagePreview}
                </span>
                {c.unreadCount > 0 && <span className="unread">{c.unreadCount}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {loaded && conversations.length === 0 && (
        <p className="muted list-empty">{q ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}</p>
      )}
    </aside>
  );
}
