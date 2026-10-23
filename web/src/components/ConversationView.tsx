import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  listMessages,
  markRead,
  reactivateMessages,
  retryMessage,
  risksOf,
  setPaused,
  type Conversation,
  type Message,
  type SendRisk,
} from "../api";
import { formatPhone } from "../format";
import { useInboxEvents } from "../useEvents";
import { Composer } from "./Composer";
import { RiskDialog } from "./RiskDialog";
import { MessageBubble } from "./MessageBubble";

const NEAR_BOTTOM_PX = 120;

/** Junta mensagens pelo id, em ordem cronológica; empates mantêm a ordem em que chegaram (sort estável). */
function merge(list: Message[], incoming: Message[]): Message[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export function ConversationView({
  conversationId,
  conversation: fromList,
  connected,
  onClose,
}: {
  conversationId: string;
  conversation: Conversation | null;
  connected: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [header, setHeader] = useState<Conversation | null>(fromList);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFrom = useRef<number | null>(null);
  const loadingOlder = useRef(false);
  // Reenvio que espera o operador confirmar os riscos de banimento (specs/004)
  const [retryRisks, setRetryRisks] = useState<{ message: Message; risks: SendRisk[] } | null>(null);

  const conversation = fromList ?? header;

  const load = useCallback(async () => {
    const page = await listMessages(conversationId);
    setMessages(page.messages);
    setHeader(page.conversation);
    setHasMore(page.hasMore);
    stickToBottom.current = true;
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => setError("Não foi possível carregar a conversa."))
      .finally(() => setLoading(false));
    markRead(conversationId).catch(() => {});
  }, [conversationId, load]);

  useInboxEvents((event) => {
    if (event.type === "reconnected") load().catch(() => {});
    if (event.type !== "message.created" && event.type !== "message.updated") return;
    if (event.conversationId !== conversationId) return;
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    setMessages((list) => merge(list, [event.message]));
    if (event.type === "message.created" && event.message.origin === "customer") markRead(conversationId).catch(() => {});
  });

  // Rola para o fim nas mensagens novas, ou preserva a posição ao carregar as antigas
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreFrom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  async function onScroll() {
    const el = scroller.current;
    if (!el || !hasMore || loadingOlder.current || el.scrollTop > 80 || messages.length === 0) return;
    loadingOlder.current = true;
    try {
      const page = await listMessages(conversationId, { before: messages[0].id });
      restoreFrom.current = el.scrollHeight - el.scrollTop;
      stickToBottom.current = false;
      setMessages((list) => merge(list, page.messages));
      setHasMore(page.hasMore);
    } finally {
      loadingOlder.current = false;
    }
  }

  async function togglePause() {
    if (!conversation) return;
    const updated = await setPaused(conversationId, !conversation.assistantPaused);
    setHeader(updated);
  }

  async function onRetry(message: Message, confirmRisk = false) {
    setRetryRisks(null);
    setMessages((list) => merge(list, [{ ...message, status: "sending", error: null }]));
    try {
      const { message: result } = await retryMessage(message.id, confirmRisk);
      setMessages((list) => merge(list, [result]));
    } catch (err) {
      const risks = risksOf(err);
      if (risks) setRetryRisks({ message, risks });
      const body = (err as { body?: { message?: Message } }).body;
      setMessages((list) => merge(list, [body?.message ?? message]));
    }
  }

  async function reactivate() {
    setHeader(await reactivateMessages(conversationId));
  }

  function onSent(message: Message) {
    stickToBottom.current = true;
    setMessages((list) => merge(list, [message]));
  }

  const title = conversation ? conversation.name || formatPhone(conversation.phone) : "";
  const paused = conversation?.assistantPaused ?? false;

  return (
    <section className="conversation-view">
      <header className="conversation-header">
        <button className="back" onClick={onClose} aria-label="Voltar para a lista">
          ←
        </button>
        <div className="title">
          <h2>{title}</h2>
          {conversation?.name && <span className="muted small">{formatPhone(conversation.phone)}</span>}
        </div>
        {conversation && (
          <div className={`assistant-state ${paused ? "paused" : "active"}`}>
            <span>{paused ? "⏸ Assistente pausado" : "🤖 Assistente ativo"}</span>
            <button onClick={togglePause}>{paused ? "Reativar" : "Pausar"}</button>
          </div>
        )}
      </header>
      {conversation?.needsAttention && (
        <div className="attention-banner" role="status">
          ⚠️ O assistente não entendeu o cliente e foi pausado. Responda por aqui ou reative o assistente.
        </div>
      )}
      {conversation?.optedOut && (
        <div className="opted-out-banner" role="status">
          🚫 O cliente pediu para não receber mensagens. O assistente não responde este número.
          <button onClick={reactivate}>Reativar</button>
        </div>
      )}

      <div className="messages" ref={scroller} onScroll={onScroll}>
        {hasMore && <p className="muted small center">Role para cima para ver mensagens anteriores</p>}
        {loading && <p className="muted center">Carregando…</p>}
        {error && <p className="error center">{error}</p>}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onRetry={onRetry} />
        ))}
      </div>

      <Composer conversationId={conversationId} connected={connected} onSent={onSent} />
      {retryRisks && (
        <RiskDialog
          risks={retryRisks.risks}
          onCancel={() => setRetryRisks(null)}
          onConfirm={() => void onRetry(retryRisks.message, true)}
        />
      )}
    </section>
  );
}
