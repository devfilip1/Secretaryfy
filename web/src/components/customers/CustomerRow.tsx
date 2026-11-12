import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Customer, CustomerAppointment } from "../../api";
import { formatPhone } from "../../format";
import { cn } from "@/lib/utils";
import { initialsOf } from "./customer-initials";

/** Colunas da tabela no desktop: nome, telefone e próxima consulta. Cabeçalho e linhas usam a mesma grade. */
export const CUSTOMER_ROW_GRID = "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)]";

/** Linha da lista: no celular, nome com telefone e próximo horário; no desktop, uma linha da tabela. */
export function CustomerRow({
  customer: c,
  next,
  label,
  selected,
  onSelect,
}: {
  customer: Customer;
  next: CustomerAppointment | null;
  label: (a: CustomerAppointment) => string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation("customers");
  const nextText = next ? label(next) : t("noUpcoming");
  return (
    <button
      type="button"
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 text-left transition-colors hover:bg-muted md:px-5 md:text-sm",
        CUSTOMER_ROW_GRID,
        selected && "bg-accent hover:bg-accent",
      )}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-info-bg text-sm font-semibold text-info">
          {initialsOf(c.name)}
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate font-semibold">{c.name}</span>
          <span className="tnum truncate text-sm text-muted-foreground md:hidden">{formatPhone(c.phone)}</span>
          <span className="truncate text-sm text-muted-foreground md:hidden">{nextText}</span>
        </span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground md:hidden" aria-hidden="true" />
      <span className="tnum hidden truncate text-muted-foreground md:block">{formatPhone(c.phone)}</span>
      <span className="hidden truncate text-muted-foreground md:block">{nextText}</span>
    </button>
  );
}
