import { useCallback, useEffect, useRef, useState } from "react";
import { clearConversations, listConversations, type Conversation } from "../api";
import { ConversationList } from "../components/ConversationList";
import { ConversationView } from "../components/ConversationView";
import { useInboxEvents } from "../useEvents";

const byRecent = (a: Conversation, b: Conversation) => b.lastMessageAt.localeCompare(a.lastMessageAt);

/** Conversa pedida no endereço (#/?c=<id>), vinda da aba de agendamentos ou da ficha do cliente (specs/006). */
function conversationFromHash(): string | null {
  const [path, query] = window.location.hash.split("?");
  return path === "#/" || path === "" ? new URLSearchParams(query).get("c") : null;
}

export function Inbox({ connected }: { connected: boolean }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelected] = useState<string | null>(conversationFromHash);
  const query = useRef("");

  // Abrir ou fechar uma conversa fica no endereço, sem navegar: voltar para a aba e o link de outra tela funcionam
  const setSelectedId = useCallback((id: string | null) => {
    setSelected(id);
    history.replaceState(null, "", id ? `#/?c=${id}` : "#/");
  }, []);

  useEffect(() => {
    const onHash = () => {
      const id = conversationFromHash();
      if (id) setSelected(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  async function onClearAll() {
    if (!window.confirm("Delete all conversations and their messages? This cannot be undone.")) return;
    try {
      await clearConversations();
      // O evento conversations.cleared também limpa a lista; aqui não depende dele chegar
      setConversations([]);
      setSelectedId(null);
    } catch {
      window.alert("Could not delete the conversations. Please try again.");
    }
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
        onClearAll={onClearAll}
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
        <section className="empty-view muted">Select a conversation</section>
      )}
    </main>
  );
}
