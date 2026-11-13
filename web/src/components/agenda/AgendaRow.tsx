import { StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Appointment } from "../../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPhone } from "../../format";
import type { useFormats } from "../../i18n/formats";
import { Muted } from "../Muted";
import type { AgendaStatus } from "./day-agenda";

export type ReminderTag = { text: string; tone: "ok" | "warn" | "bad" | "muted"; title?: string };

const TAG_TONE: Record<ReminderTag["tone"], string> = {
  ok: "text-ok",
  warn: "",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

/** Faixa da situação: cheia = confirmada, vazada = aguardando, coral (token destructive) = precisa da equipe. */
const RAIL: Record<AgendaStatus, string> = {
  confirmed: "bg-ok",
  waiting: "bg-transparent ring-2 ring-inset ring-muted-foreground",
  needs_team: "bg-destructive",
};

interface AgendaRowProps {
  appointment: Appointment;
  status: AgendaStatus;
  tag: ReminderTag | null;
  formats: ReturnType<typeof useFormats>;
  busy: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
}

/** Uma consulta na linha do tempo: horário, faixa da situação, paciente, serviço, lembrete e ações. */
export function AgendaRow({ appointment: a, status, tag, formats, busy, onConfirm, onEdit, onCancel }: AgendaRowProps) {
  const { t } = useTranslation("appointments");
  const start = new Date(a.startsAt);
  const range = t("range", { start: formats.time.format(start), end: formats.time.format(new Date(a.endsAt)) });

  return (
    <li className="flex gap-3 border-b border-border py-3">
      <time dateTime={a.startsAt} className="w-16 shrink-0 pt-0.5 text-sm font-semibold tnum">
        {formats.time.format(start)}
      </time>
      <span aria-hidden="true" className={cn("w-1 shrink-0 self-stretch rounded-full", RAIL[status])} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold">{a.customerName}</span>
            {tag && (
              <Badge variant={tag.tone === "warn" ? "warn" : "secondary"} className={cn("shrink-0 py-px font-normal", TAG_TONE[tag.tone])} title={tag.title}>
                {tag.text}
              </Badge>
            )}
          </span>
          <Muted className="tnum">
            {range} · {t("minutes", { minutes: a.minutes })}
          </Muted>
          {/* Espaços e hífen do telefone viram não separáveis: o número não quebra no meio na tela estreita. */}
          <Muted className="tnum">
            {t(a.origin === "panel" ? "serviceLineHere" : "serviceLine", {
              service: a.service ?? "-",
              phone: formatPhone(a.phone).replace(/ /g, " ").replace(/-/g, "‑"),
            })}
          </Muted>
          {a.notes && (
            <Muted tone="warn" className="wrap-anywhere">
              <StickyNote className="mr-1 inline size-3.5" />
              {a.notes}
            </Muted>
          )}
        </div>
        {/* Colunas fixas: confirmar, editar, cancelar e abrir conversa ficam na mesma posição em todas as linhas. Na tela estreita, 2 botões lado a lado e o link embaixo. */}
        <div className="grid grid-cols-2 gap-2 text-sm md:shrink-0 md:grid-cols-[7.5rem_5.5rem_6.5rem_10rem]">
          <div className="flex justify-end">
            {!a.confirmedAt && (
              <Button
                variant={a.reminder.label === "remind_manually" ? "default" : "secondary"}
                className="w-full md:w-auto"
                onClick={onConfirm}
                disabled={busy}
                title={t("confirm.hint")}
              >
                {busy ? t("confirm.busy") : t("confirm.button")}
              </Button>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" className="w-full md:w-auto" onClick={onEdit}>
              {t("edit.button")}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" className="w-full text-destructive md:w-auto" onClick={onCancel}>
              {t("cancel")}
            </Button>
          </div>
          <div className="col-span-2 text-center md:col-span-1 md:text-right">
            {a.conversationId && <a href={`#/?c=${a.conversationId}`}>{t("openConversation")}</a>}
          </div>
        </div>
      </div>
    </li>
  );
}
