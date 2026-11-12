import type { LucideIcon } from "lucide-react";
import { Check, CircleAlert, CircleCheck, Clock, Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Message } from "../api";
import { useBlockReasonText } from "../i18n/blockReason";
import { useFormats } from "../i18n/formats";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Muted } from "./Muted";
import { useSystemNoteText } from "./system-note";
import { toneOfNote, type NoteTone } from "./system-note-tone";

const STATUS_ICON: Partial<Record<Message["status"], LucideIcon>> = {
  sending: Clock,
  sent: Check,
  failed: TriangleAlert,
  blocked: ShieldAlert,
};

// Ícone e cores da pílula de um registro do sistema, conforme a situação (alerta é o mais forte)
const NOTE_TONE: Record<NoteTone, { icon: LucideIcon; pill: string }> = {
  alert: { icon: TriangleAlert, pill: "border-destructive bg-alert font-bold text-destructive" },
  warn: { icon: CircleAlert, pill: "border-warn bg-warn-bg text-warn" },
  ok: { icon: CircleCheck, pill: "border-ok bg-ok-bg text-ok" },
  info: { icon: Info, pill: "border-info bg-info-bg text-info" },
  neutral: { icon: Info, pill: "border-border bg-secondary text-muted-foreground" },
};

// Cor de fundo de cada origem; "system" não tem balão (ver abaixo)
const BUBBLE_BG: Record<Message["origin"], string> = {
  customer: "bg-bubble-customer",
  assistant: "bg-bubble-assistant",
  operator: "bg-bubble-operator",
  phone: "bg-bubble-phone",
  system: "",
};

export function MessageBubble({ message, onRetry, customerName }: { message: Message; onRetry?: (m: Message) => void; customerName?: string | null }) {
  const { t } = useTranslation("inbox");
  const { formatDateTime, formatTime } = useFormats();
  const blockReasonText = useBlockReasonText();
  const label = message.type === "text" ? null : t(`media.${message.type}`);
  const mine = message.origin !== "customer";
  const systemText = useSystemNoteText(message);
  // Balão do cliente mostra o nome do paciente quando a conversa tem um; sem nome, o rótulo da origem
  const customer = customerName?.trim();
  const senderLabel = message.origin === "customer" && customer ? customer : t(`origin.${message.origin}`);

  // Registro do Secretaryfy (ex.: agendamento feito pelo assistente): pílula centralizada, sem balão; a cor segue a situação
  if (message.origin === "system") {
    const { icon: ToneIcon, pill } = NOTE_TONE[toneOfNote(message.note)];
    return (
      <div
        className={cn(
          "mx-auto my-1.5 flex max-w-[90%] items-center gap-1.5 self-center rounded-full border-l-3 px-3 py-1 text-[13px]",
          pill,
        )}
        title={formatDateTime(message.sentAt)}
      >
        <ToneIcon className="size-4 shrink-0" aria-hidden />
        <span>
          {systemText} · {formatTime(message.sentAt)}
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
        <Muted className="text-xs font-bold">{senderLabel}</Muted>
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
          <span className="flex flex-wrap gap-2 text-xs text-destructive" title={message.error ?? undefined}>
            {t("failedSend")}
            {message.origin === "operator" && onRetry && (
              <Button variant="link" className="text-xs" onClick={() => onRetry(message)}>
                {t("message.tryAgain")}
              </Button>
            )}
          </span>
        )}
        {blocked && <Muted className="text-xs">{t("message.notSentByProtection", { reason: blockReasonText(message.error) })}</Muted>}
      </div>
    </div>
  );
}
