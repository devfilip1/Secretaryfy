import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ban, Bot, Pause, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { Button } from "./ui/button";
import { Composer } from "./Composer";
import { Muted } from "./Muted";
import { Notice } from "./Notice";
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
  const { t } = useTranslation("inbox");
  const [messages, setMessages] = useState<Message[]>([]);
  const [header, setHeader] = useState<Conversation | null>(fromList);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  // Só a falha: o texto sai de inbox.json no idioma atual, então troca junto com o painel
  const [loadFailed, setLoadFailed] = useState(false);
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
      .catch(() => setLoadFailed(true))
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
    <section className="flex min-h-0 flex-col bg-chat max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:z-1">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 max-md:gap-2 max-md:px-3 max-md:py-2">
        <Button variant="secondary" className="hidden max-md:inline-flex" onClick={onClose} aria-label={t("backToList")}>
          ←
        </Button>
        <div className="min-w-0 flex-1 max-md:[&_span]:whitespace-nowrap">
          <h2 className="m-0 text-base font-bold">{title}</h2>
          {conversation?.name && <Muted>{formatPhone(conversation.phone)}</Muted>}
        </div>
        {conversation && (
          <div className="flex items-center gap-2.5 text-sm max-md:gap-2 max-md:text-base">
            <span className={paused ? "font-semibold text-warn" : undefined} title={paused ? t("assistant.paused") : t("assistant.active")}>
              {paused ? <Pause className="inline size-4" /> : <Bot className="inline size-4" />}
              <span className="max-md:hidden"> {paused ? t("assistant.paused") : t("assistant.active")}</span>
            </span>
            <Button variant="secondary" onClick={togglePause}>
              {paused ? t("assistant.resume") : t("assistant.pause")}
            </Button>
          </div>
        )}
      </header>
      {conversation?.needsAttention && (
        <Notice layout="bar" tone="warn" role="status" className="text-sm">
          <TriangleAlert className="mr-1 inline size-4" />
          {t("attention.notice")}
        </Notice>
      )}
      {conversation?.optedOut && (
        <Notice layout="bar" tone="destructive" role="status" className="flex items-center justify-between gap-3 text-sm max-md:flex-wrap">
          <span>
            <Ban className="mr-1 inline size-4" />
            {t("optedOut.notice")}
          </span>
          <Button variant="secondary" onClick={reactivate}>
            {t("optedOut.reactivate")}
          </Button>
        </Notice>
      )}

      <div
        className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-[6%] py-4 max-md:px-2.5 max-md:py-3"
        ref={scroller}
        onScroll={onScroll}
      >
        {hasMore && (
          <Muted as="p" className="my-4 text-center">
            {t("loadEarlier")}
          </Muted>
        )}
        {loading && <p className="text-center text-muted-foreground">{t("loading")}</p>}
        {loadFailed && <Notice className="text-center">{t("errors.loadConversation")}</Notice>}
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
