import type { LucideIcon } from "lucide-react";
import { Check, Clock, Info, ShieldAlert, TriangleAlert } from "lucide-react";
import type { Message } from "../api";
import { blockReasonText, formatDateTime, formatTime, mediaLabel, originLabel } from "../format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Muted } from "./Muted";

const STATUS_ICON: Partial<Record<Message["status"], LucideIcon>> = {
  sending: Clock,
  sent: Check,
  failed: TriangleAlert,
  blocked: ShieldAlert,
};

// Cor de fundo de cada origem; "system" não tem balão (ver abaixo)
const BUBBLE_BG: Record<Message["origin"], string> = {
  customer: "bg-bubble-customer",
  assistant: "bg-bubble-assistant",
  operator: "bg-bubble-operator",
  phone: "bg-bubble-phone",
  system: "",
};

export function MessageBubble({ message, onRetry }: { message: Message; onRetry?: (m: Message) => void }) {
  const label = mediaLabel(message.type);
  const mine = message.origin !== "customer";

  // Registro do Secretaryfy (ex.: agendamento feito pelo assistente): linha centralizada, sem balão
  if (message.origin === "system") {
    return (
      <div
        className="mx-auto my-1.5 flex max-w-[90%] items-center gap-1.5 self-center rounded-lg bg-card px-2.5 py-1 text-center text-sm text-muted-foreground"
        title={formatDateTime(message.sentAt)}
      >
        <Info className="size-3.5 shrink-0" aria-hidden />
        <span>
          {message.text} · {formatTime(message.sentAt)}
        </span>
      </div>
    );
  }

  const failed = message.status === "failed";
  const blocked = message.status === "blocked";
  const StatusIcon = STATUS_ICON[message.status];

  return (
    <div className={cn("flex", mine && "justify-end")}>
      <div
        className={cn(
          "flex max-w-[min(70%,560px)] flex-col gap-0.5 rounded-lg px-2.5 pt-1.5 pb-1 shadow-bubble max-md:max-w-[85%]",
          BUBBLE_BG[message.origin],
          failed && "outline-1 outline-solid outline-destructive",
          blocked && "opacity-75 outline-1 outline-dashed outline-muted-foreground",
        )}
      >
        <Muted className="text-xs font-bold">{originLabel(message.origin)}</Muted>
        {label && <span className="italic">{label}</span>}
        {message.text && <p className="whitespace-pre-wrap wrap-anywhere">{message.text}</p>}
        <span className="self-end text-xs text-muted-foreground" title={formatDateTime(message.sentAt)}>
          {formatTime(message.sentAt)}
          {StatusIcon && (
            <span className="ml-1 inline-block align-[-2px]" title={message.error ?? undefined}>
              <StatusIcon className="size-3" />
            </span>
          )}
        </span>
        {failed && (
          <span className="flex flex-wrap gap-2 text-xs text-destructive">
            Not sent{message.error ? `: ${message.error}` : ""}
            {message.origin === "operator" && onRetry && (
              <Button variant="link" className="text-xs" onClick={() => onRetry(message)}>
                Try again
              </Button>
            )}
          </span>
        )}
        {blocked && <Muted className="text-xs">Not sent by protection: {blockReasonText(message.error)}</Muted>}
      </div>
    </div>
  );
}
