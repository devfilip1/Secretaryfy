import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "../../lib/utils";
import type { DayLayout, Pin, PinStatus } from "./layout";

// Pino por situação: confirmada cheia; aguardando vazada; precisa da equipe cheia em vermelho
const PIN_STATUS: Record<PinStatus, string> = {
  confirmed: "border-primary bg-primary",
  waiting: "border-primary bg-card",
  needs_team: "border-destructive bg-destructive",
};

/** Régua do dia: linha do horário de funcionamento, marcas de 2 em 2 horas, um pino por consulta e a hora atual. */
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
                  "absolute size-[15px] -translate-x-1/2 rounded-full border-2",
                  PIN_STATUS[pin.status],
                  pin.lane === 0 ? "top-[3.5px]" : "top-[19.5px]",
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
