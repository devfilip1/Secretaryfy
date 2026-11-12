import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AGENDA_RANGES, type AgendaRange } from "./agenda-range";

interface RangeSwitchProps {
  value: AgendaRange;
  onChange: (range: AgendaRange) => void;
}

/** Alcance da agenda: Dia, 7 dias ou Mês. Botões com aria-pressed (sem o componente de abas, que é de painéis). */
export function RangeSwitch({ value, onChange }: RangeSwitchProps) {
  const { t } = useTranslation("appointments");
  const labels: Record<AgendaRange, string> = { day: t("view.day"), week: t("view.week"), month: t("view.month") };
  return (
    <div role="group" aria-label={t("view.label")} className="mb-3 flex w-full rounded-md border border-border p-0.5 sm:w-auto">
      {AGENDA_RANGES.map((range) => (
        <Button
          key={range}
          size="sm"
          variant={range === value ? "secondary" : "ghost"}
          aria-pressed={range === value}
          onClick={() => onChange(range)}
          className="min-w-0 flex-1 whitespace-nowrap"
        >
          {labels[range]}
        </Button>
      ))}
    </div>
  );
}
