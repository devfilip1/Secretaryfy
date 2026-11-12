import { ChevronDown, ChevronRight, StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Customer, CustomerAppointment } from "../../api";
import { formatPhone } from "../../format";
import { cn } from "@/lib/utils";
import { initialsOf } from "./customer-initials";

/** Linha da lista: avatar com iniciais, nome, telefone, próximo horário (ponto verde) e anotação (pílula). */
export function CustomerRow({
  customer: c,
  next,
  label,
  expanded,
  onToggle,
}: {
  customer: Customer;
  next: CustomerAppointment | null;
  label: (a: CustomerAppointment) => string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("customers");
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      className={cn(
        "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted max-md:px-1",
        expanded && "bg-muted",
      )}
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-info-bg text-sm font-semibold text-info">
        {initialsOf(c.name)}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate font-semibold">{c.name}</span>
        <span className="tnum truncate text-sm text-muted-foreground">{formatPhone(c.phone)}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-sm">
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", next ? "bg-ok" : "bg-muted-foreground")} />
          <span className="truncate text-muted-foreground">{next ? t("nextAppointment", { when: label(next) }) : t("noUpcoming")}</span>
        </span>
        {c.notes && !expanded && (
          <span className="mt-0.5 inline-flex w-fit max-w-full items-center gap-1 rounded-full bg-warn-bg px-2 py-0.5 text-xs text-warn">
            <StickyNote className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{c.notes}</span>
          </span>
        )}
      </span>
      <Chevron className="size-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
