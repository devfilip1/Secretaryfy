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
  onClearAll,
}: {
  conversations: Conversation[];
  loaded: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSearch: (q: string) => void;
  onClearAll: () => void;
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
        placeholder="Search by name or number"
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
                    <span className="paused-icon" title="Assistant paused">
                      ⏸{" "}
                    </span>
                  )}
                  {c.name || formatPhone(c.phone)}
                  {c.optedOut && (
                    <span className="opted-out-icon" title="Asked not to receive messages">
                      {" "}
                      🚫
                    </span>
                  )}
                </span>
                <span className="time">{formatTime(c.lastMessageAt)}</span>
              </span>
              <span className="row">
                <span className="preview">
                  {c.needsAttention && <span className="attention-tag">Needs attention</span>}
                  {c.lastMessagePreview}
                </span>
                {c.unreadCount > 0 && <span className="unread">{c.unreadCount}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {loaded && conversations.length === 0 && (
        <p className="muted list-empty">{q ? "No conversations found" : "No conversations yet"}</p>
      )}
      {conversations.length > 0 && !q && (
        <footer className="list-footer">
          <button className="clear-all" onClick={onClearAll}>
            🗑 Delete all conversations
          </button>
        </footer>
      )}
    </aside>
  );
}
