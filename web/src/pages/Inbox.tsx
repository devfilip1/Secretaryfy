import { useCallback, useEffect, useRef, useState } from "react";
import { listConversations, type Conversation } from "../api";
import { ConversationList } from "../components/ConversationList";
import { ConversationView } from "../components/ConversationView";
import { useInboxEvents } from "../useEvents";

const byRecent = (a: Conversation, b: Conversation) => b.lastMessageAt.localeCompare(a.lastMessageAt);

export function Inbox({ connected }: { connected: boolean }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useRef("");

  const load = useCallback(async () => {
    const q = query.current;
    const { conversations } = await listConversations(q);
    if (q === query.current) {
      setConversations(conversations);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load().catch(() => setLoaded(true));
  }, [load]);

  useInboxEvents((event) => {
    if (event.type === "reconnected") load().catch(() => {});
    if (event.type === "conversations.cleared") {
      setConversations([]);
      setSelectedId(null);
      return;
    }
    if (event.type !== "conversation.updated") return;
    const updated = event.conversation;
    setConversations((list) => {
      const exists = list.some((c) => c.id === updated.id);
      // Com busca ativa, só atualiza as que já aparecem; sem busca, conversas novas entram no topo
      if (!exists && query.current) return list;
      const next = exists ? list.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...list];
      return next.sort(byRecent);
    });
  });

  function onSearch(q: string) {
    query.current = q;
    load().catch(() => {});
  }

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <main className="inbox">
      <ConversationList
        conversations={conversations}
        loaded={loaded}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onSearch={onSearch}
      />
      {selectedId ? (
        <ConversationView
          key={selectedId}
          conversationId={selectedId}
          conversation={selected}
          connected={connected}
          onClose={() => setSelectedId(null)}
        />
      ) : (
        <section className="empty-view muted">Selecione uma conversa</section>
      )}
    </main>
  );
}
