import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Customer, CustomerAppointment } from "../../api";
import { formatPhone } from "../../format";
import { cn } from "@/lib/utils";
import { initialsOf } from "./customer-initials";

/** Colunas da tabela no desktop: nome, telefone e próxima consulta. Cabeçalho e linhas usam a mesma grade. */
export const CUSTOMER_ROW_GRID = "md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.4fr)]";

/** Linha da lista: no celular, nome com telefone e próximo horário; no desktop, uma linha da tabela. */
export function CustomerRow({
  customer: c,
  next,
  whenLabel,
  selected,
  onSelect,
}: {
  customer: Customer;
  next: CustomerAppointment | null;
  whenLabel: (a: CustomerAppointment) => string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation("customers");
  // Dia e hora na primeira linha, serviço embaixo em cinza; só corta se faltar espaço
  const nextLines = next ? (
    <>
      <span className="truncate whitespace-nowrap">{whenLabel(next)}</span>
      {next.service && <span className="truncate text-xs text-muted-foreground">{next.service}</span>}
    </>
  ) : (
    <span className="truncate whitespace-nowrap">{t("noUpcoming")}</span>
  );
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
          <span className="tnum truncate whitespace-nowrap text-sm text-muted-foreground md:hidden">{formatPhone(c.phone)}</span>
          <span className="grid min-w-0 gap-0.5 text-sm text-muted-foreground md:hidden">{nextLines}</span>
        </span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground md:hidden" aria-hidden="true" />
      <span className="tnum hidden truncate whitespace-nowrap text-muted-foreground md:block">{formatPhone(c.phone)}</span>
      <span className="hidden min-w-0 grid-cols-1 gap-0.5 text-muted-foreground md:grid">{nextLines}</span>
    </button>
  );
}
