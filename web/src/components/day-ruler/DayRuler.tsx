import { Check, Play } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "../../lib/utils";
import type { DayLayout, Pin, PinStatus } from "./layout";

// Bloco sólido por situação: confirmada, aguardando (amarelo de aviso) ou precisa da equipe
const BLOCK_STATUS: Record<PinStatus, string> = {
  confirmed: "bg-ok",
  waiting: "bg-warn",
  needs_team: "bg-destructive",
};

// Já passada: a mesma cor misturada com a superfície, menos saturada (sólida, sem opacidade)
const PASSED_STATUS: Record<PinStatus, string> = {
  confirmed: "bg-[color-mix(in_srgb,var(--ok)_40%,var(--surface))]",
  waiting: "bg-[color-mix(in_srgb,var(--warn)_40%,var(--surface))]",
  needs_team: "bg-[color-mix(in_srgb,var(--bad)_40%,var(--surface))]",
};

/** Linha do dia no centro de uma faixa de 24 px; a faixa 0 tem o bloco de 20 px centralizado nela. */
const TRACK_CENTER_PX = 12;
const BLOCK_HEIGHT_PX = 20;
/** Cada faixa extra abaixo da primeira ocupa esta altura (bloco + 2 px de folga). */
const LANE_PITCH_PX = 22;

/**
 * Régua do dia: linha do horário de funcionamento (preenchida até agora), marcas de 2 em 2 horas, um bloco por consulta
 * (largura = duração) e a hora atual. A régua só cresce para baixo quando há consultas sobrepostas.
 * A barra de progresso é decorativa: o resumo acima já diz quantas consultas faltam.
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
  const height = 2 * TRACK_CENTER_PX + (layout.lanes - 1) * LANE_PITCH_PX;
  return (
    <div className="mt-1">
      <div className="relative" style={{ height: `${height}px` }}>
        <span className="absolute inset-x-0 h-0.5 bg-border" style={{ top: `${TRACK_CENTER_PX - 1}px` }} />
        <span
          aria-hidden="true"
          className="absolute left-0 h-0.5 bg-primary"
          style={{ top: `${TRACK_CENTER_PX - 1}px`, width: `${layout.progressPct}%` }}
        />
        {layout.ticks.map((tick) => (
          <span
            key={tick.minutes}
            className="absolute h-2 w-px bg-muted-foreground"
            style={{ left: `${tick.leftPct}%`, top: `${TRACK_CENTER_PX - 4}px` }}
          />
        ))}
        {layout.pins.map((pin) => (
          <Tooltip key={pin.id}>
            <TooltipTrigger asChild>
              <a
                href="#/appointments"
                aria-label={pinLabel(pin)}
                className={cn(
                  "absolute flex h-5 min-w-3.5 items-center justify-center rounded-[6px]",
                  pin.passed && !pin.inProgress ? PASSED_STATUS[pin.status] : BLOCK_STATUS[pin.status],
                  pin.inProgress ? "text-primary-foreground" : pin.passed ? "text-foreground" : undefined,
                )}
                style={{
                  left: `${pin.leftPct}%`,
                  width: `${pin.widthPct}%`,
                  top: `${TRACK_CENTER_PX - BLOCK_HEIGHT_PX / 2 + pin.lane * LANE_PITCH_PX}px`,
                }}
              >
                {pin.inProgress && <Play aria-hidden="true" size={12} className="fill-current" />}
                {pin.passed && !pin.inProgress && <Check aria-hidden="true" size={12} />}
              </a>
            </TooltipTrigger>
            <TooltipContent>{pinLabel(pin)}</TooltipContent>
          </Tooltip>
        ))}
        {layout.nowPct !== null && (
          <span className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${layout.nowPct}%` }} />
        )}
      </div>
      <div className="relative h-3.5 text-[10px] text-muted-foreground tnum">
        {layout.ticks.map((tick) =>
          tick.labelShown ? (
            <span key={tick.minutes} className={`absolute whitespace-nowrap ${tick.leftPct >= 99 ? "-translate-x-full" : tick.leftPct <= 1 ? "" : "-translate-x-1/2"}`} style={{ left: `${tick.leftPct}%` }}>
              {tickLabel(tick.minutes)}
            </span>
          ) : null,
        )}
        {layout.nowPct !== null && (
          <span className="absolute -translate-x-1/2 font-bold whitespace-nowrap text-foreground" style={{ left: `${layout.nowPct}%` }}>
            {nowLabel}
          </span>
        )}
      </div>
    </div>
  );
}
