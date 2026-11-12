import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface DayHeaderProps {
  /** Data por extenso, já formatada no fuso da clínica */
  label: string;
  /** Posição do dia na janela de 0 até last */
  index: number;
  last: number;
  onMove: (delta: number) => void;
  onToday: () => void;
}

/** Cabeçalho do dia: setas para os outros dias da janela e volta para hoje. */
export function DayHeader({ label, index, last, onMove, onToday }: DayHeaderProps) {
  const { t } = useTranslation("appointments");
  return (
    <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon-sm" aria-label={t("agenda.prev")} disabled={index === 0} onClick={() => onMove(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label={t("agenda.next")} disabled={index === last} onClick={() => onMove(1)}>
          <ChevronRight />
        </Button>
      </div>
      <strong className="min-w-0 truncate text-center">{label}</strong>
      <Button variant="ghost" size="sm" className="text-foreground disabled:opacity-100 disabled:hover:bg-transparent" disabled={index === 0} onClick={onToday}>
        {t("agenda.today")}
      </Button>
    </div>
  );
}
