import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getClinicSettings } from "../../api";
import { localeOf, useFormats } from "../../i18n/formats";
import { DayRuler } from "./DayRuler";
import { greetingKey } from "./greeting";
import { clockLabel, layoutDay, minutesOfDay, type Pin, type PinStatus } from "./layout";
import { useToday } from "./useToday";

const STATUS_KEY: Record<PinStatus, "confirmed" | "waiting" | "needsTeam"> = {
  confirmed: "confirmed",
  waiting: "waiting",
  needs_team: "needsTeam",
};

/** Faixa do topo de Conversas: saudação, quantas consultas hoje e a régua do dia. */
export function TodayStrip({ attentionPhones }: { attentionPhones: ReadonlySet<string> }) {
  const { t, i18n } = useTranslation("inbox");
  const locale = localeOf(i18n.language);
  const { now, timeZone, day } = useToday();
  const formats = useFormats(timeZone);
  const [clinic, setClinic] = useState<string | null>(null);

  useEffect(() => {
    getClinicSettings()
      .then((settings) => setClinic(settings.name))
      .catch(() => {});
  }, []);

  const period = greetingKey(Math.floor(minutesOfDay(now, timeZone) / 60));
  const greeting = clinic ? t(`today.greeting.${period}`, { clinic }) : t(`today.greeting.${period}Plain`);
  const layout = day && layoutDay({ appointments: day.appointments, hours: day.hours, now, timeZone, attentionPhones });

  const pinLabel = (pin: Pin) =>
    t("today.pin", {
      time: formats.formatClock(pin.startsAt),
      name: pin.customerName,
      service: pin.service ?? t("today.noService"),
      status: t(`today.status.${STATUS_KEY[pin.status]}`),
    });

  let summary = "";
  if (layout && !layout.open) summary = t("today.closed");
  else if (layout && layout.count === 0) summary = t("today.none");
  else if (layout) {
    const next = layout.next
      ? t("today.next", { time: formats.formatClock(layout.next.startsAt), name: layout.next.customerName })
      : t("today.noneLeft");
    summary = `${t("today.summary", { count: layout.count })} ${next}`;
  }

  return (
    <TooltipProvider>
      <section aria-label={t("today.label")} className="border-b border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="text-[15px] font-bold">{greeting}</p>
          {summary && <p className="text-[13px] text-muted-foreground">{summary}</p>}
        </div>
        {layout?.open && (
          <DayRuler
            layout={layout}
            tickLabel={(minutes) => clockLabel(minutes, locale)}
            pinLabel={pinLabel}
            nowLabel={t("today.now")}
          />
        )}
      </section>
    </TooltipProvider>
  );
}
