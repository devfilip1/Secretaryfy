import { useEffect, useRef, useState } from "react";
import { Ban, Pause, Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Conversation } from "../api";
import { formatPhone } from "../format";
import { useFormats } from "../i18n/formats";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

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
  const { t } = useTranslation("inbox");
  const { formatTime } = useFormats();
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
    <aside className="flex min-h-0 flex-col border-r border-border bg-card max-md:border-r-0">
      {/* Margem dentro de um bloco, não na própria busca: o input tem w-full e a margem o empurrava para fora da coluna */}
      <div className="p-2.5">
        <Input
          type="search"
          placeholder={t("search.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ul className="overflow-y-auto">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              className={cn(
                "flex w-full cursor-pointer flex-col gap-1 border-0 border-b border-border px-3.5 py-2.5 text-left text-foreground max-md:min-h-10 max-md:px-4 max-md:py-3",
                c.id === selectedId ? "bg-accent" : "hover:bg-muted",
                c.needsAttention && "shadow-stripe-warn",
              )}
              onClick={() => onSelect(c.id)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">
                  {c.assistantPaused && (
                    <span title={t("assistant.paused")}>
                      <Pause className="inline size-3.5" />
                    </span>
                  )}
                  {c.name || formatPhone(c.phone)}
                  {c.optedOut && (
                    <span className="text-sm" title={t("optedOut.title")}>
                      {" "}
                      <Ban className="inline size-3.5" />
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatTime(c.lastMessageAt)}</span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-muted-foreground">
                  {c.needsAttention && <Badge variant="warn" className="mr-1.5">{t("attention.badge")}</Badge>}
                  {c.lastMessagePreview}
                </span>
                {c.unreadCount > 0 && <Badge className="shrink-0">{c.unreadCount}</Badge>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {loaded && conversations.length === 0 && (
        <p className="p-4 text-center text-muted-foreground">{q ? t("list.noResults") : t("list.empty")}</p>
      )}
      {conversations.length > 0 && !q && (
        <footer className="mt-auto border-t border-border p-2.5">
          <Button variant="secondary" className="w-full text-sm text-destructive" onClick={onClearAll}>
            <Trash className="size-4" />
            {t("deleteAll.button")}
          </Button>
        </footer>
      )}
    </aside>
  );
}
