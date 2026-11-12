import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "../../lib/utils";
import type { DayLayout, Pin, PinStatus } from "./layout";

// Pino por situação: confirmada cheia; aguardando vazada; precisa da equipe cheia em vermelho
const PIN_STATUS: Record<PinStatus, string> = {
  confirmed: "border-primary bg-primary",
  waiting: "border-primary bg-card",
  needs_team: "border-destructive bg-destructive",
};

// Pino já passado: menor, apagado e com anel; o centro fica na mesma altura do pino cheio
const PASSED_TOP = { 0: "top-[5.5px]", 1: "top-[21.5px]" } as const;
const PENDING_TOP = { 0: "top-[3.5px]", 1: "top-[19.5px]" } as const;

/**
 * Régua do dia: linha do horário de funcionamento (preenchida até agora), marcas de 2 em 2 horas, um pino por consulta
 * e a hora atual. A barra de progresso é decorativa: o resumo acima já diz quantas consultas faltam.
 */
export function DayRuler({
  layout,
  tickLabel,
  pinLabel,
  nowLabel,
}: {
  layout: DayLayout;
  tickLabel: (minutes: number) => string;
  pinLabel: (pin: Pin) => string;
  nowLabel: string;
}) {
  return (
    <div className="mt-1">
      <div className="relative h-9">
        <span className="absolute inset-x-0 top-2.5 h-0.5 bg-border" />
        <span aria-hidden="true" className="absolute top-2.5 left-0 h-0.5 bg-primary" style={{ width: `${layout.progressPct}%` }} />
        {layout.ticks.map((tick) => (
          <span key={tick.minutes} className="absolute top-[7px] h-2 w-px bg-muted-foreground" style={{ left: `${tick.leftPct}%` }} />
        ))}
        {layout.nowPct !== null && (
          <span className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${layout.nowPct}%` }} />
        )}
        {layout.pins.map((pin) => (
          <Tooltip key={pin.id}>
            <TooltipTrigger asChild>
              <a
                href="#/appointments"
                aria-label={pinLabel(pin)}
                className={cn(
                  "absolute -translate-x-1/2 rounded-full border-2",
                  PIN_STATUS[pin.status],
                  pin.passed ? "size-[11px] opacity-50 ring-1 ring-foreground/30" : "size-[15px]",
                  pin.passed ? PASSED_TOP[pin.lane] : PENDING_TOP[pin.lane],
                )}
                style={{ left: `${pin.leftPct}%` }}
              />
            </TooltipTrigger>
            <TooltipContent>{pinLabel(pin)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="relative h-3.5 text-[10px] text-muted-foreground tnum">
        {layout.ticks.map((tick) => (
          <span key={tick.minutes} className={`absolute whitespace-nowrap ${tick.leftPct >= 99 ? "-translate-x-full" : tick.leftPct <= 1 ? "" : "-translate-x-1/2"}`} style={{ left: `${tick.leftPct}%` }}>
            {tickLabel(tick.minutes)}
          </span>
        ))}
        {layout.nowPct !== null && (
          <span className="absolute -translate-x-1/2 font-bold whitespace-nowrap text-foreground" style={{ left: `${layout.nowPct}%` }}>
            {nowLabel}
          </span>
        )}
      </div>
    </div>
  );
}
