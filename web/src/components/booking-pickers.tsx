import { useId, useMemo, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { CalendarIcon } from "lucide-react";
import type { BookingStart } from "../api";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { useFormats } from "../i18n/formats";
import { toDate, toYmd } from "./date-string";
import { endOfRoom, formatMinutes, MIN_DURATION, parseDuration, validateDuration, type DurationError } from "./duration";
import { durationPresets, groupByDayPart, type DayPart } from "./time-groups";
import { Muted } from "./Muted";

/** Os seletores de dia, horário e duração da marcação e da edição (specs/006 US3; edição, ADR 0015). */

type Formats = ReturnType<typeof useFormats>;
export type DayRange = { minDate: string; maxDate: string };

/** Horário, dia ou duração escolhidos: o selecionado fica preenchido (primary); os outros ficam secundários. */
export function Choice({ selected, ...props }: ComponentProps<typeof Button> & { selected: boolean }) {
  return <Button type="button" size="sm" variant={selected ? "default" : "secondary"} {...props} />;
}

/** Dias da janela: os chips, e o calendário com o estado de cada dia (livre ou lotado) para o serviço escolhido. */
export function DayField({
  formats,
  days,
  range,
  status,
  day,
  onPick,
}: {
  formats: Formats;
  days: string[] | null;
  range: DayRange | null;
  status: Record<string, "free" | "full">;
  day: string | null;
  onPick: (day: string) => void;
}) {
  const { t } = useTranslation("appointments");
  const [pickerOpen, setPickerOpen] = useState(false);
  const otherDateId = useId();
  // Dias vêm como YYYY-MM-DD no fuso da clínica: o meio-dia UTC cai no mesmo dia em qualquer fuso do Brasil
  const dayLabel = (d: string) => formats.day.format(new Date(`${d}T12:00:00Z`));
  // Dias do calendário com pontinho: verde se há horário livre, vermelho se está lotado; fechado não tem pontinho
  const statusDates = useMemo(() => {
    const entries = Object.entries(status);
    return {
      free: entries.filter(([, s]) => s === "free").map(([d]) => toDate(d)),
      full: entries.filter(([, s]) => s === "full").map(([d]) => toDate(d)),
    };
  }, [status]);

  return (
    <FieldSet>
      <FieldLegend variant="label">{t("form.day")}</FieldLegend>
      {days === null ? (
        <Muted>{t("form.loadingDays")}</Muted>
      ) : days.length === 0 ? (
        <Muted>{t("form.noDays")}</Muted>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <Choice key={d} selected={d === day} onClick={() => onPick(d)}>
              {dayLabel(d)}
            </Choice>
          ))}
        </div>
      )}
      {range && (
        // Outra data (até um ano à frente): o mesmo `day` dos chips, então o chip e o calendário mostram sempre o mesmo dia
        <div className="grid gap-1">
          <Label htmlFor={otherDateId}>{t("form.otherDate")}</Label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button id={otherDateId} variant="outline" className="w-full justify-start font-normal sm:w-auto">
                <CalendarIcon />
                {day ? dayLabel(day) : t("form.pickDate")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={day ? toDate(day) : undefined}
                defaultMonth={day ? toDate(day) : toDate(range.minDate)}
                startMonth={toDate(range.minDate)}
                endMonth={toDate(range.maxDate)}
                disabled={[{ before: toDate(range.minDate) }, { after: toDate(range.maxDate) }]}
                modifiers={{ free: statusDates.free, full: statusDates.full }}
                onSelect={(picked) => {
                  if (!picked) return;
                  onPick(toYmd(picked));
                  setPickerOpen(false);
                }}
              />
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2">
                <Muted className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
                  {t("calendar.freeTimes")}
                </Muted>
                <Muted className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
                  {t("calendar.fullyBooked")}
                </Muted>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </FieldSet>
  );
}

/** Horários do dia: os sugeridos, e os outros inícios livres recolhidos (de 15 em 15 minutos). */
export function StartField({
  formats,
  timeZone,
  slots,
  starts,
  start,
  onPick,
}: {
  formats: Formats;
  timeZone: string | undefined;
  slots: string[] | null;
  starts: BookingStart[] | null;
  start: string | null;
  onPick: (start: string) => void;
}) {
  const { t } = useTranslation("appointments");
  // Os inícios de 15 em 15 minutos ficam recolhidos; os horários sugeridos já cobrem o comum
  const [showAll, setShowAll] = useState(false);
  const partLabel: Record<DayPart, string> = {
    Morning: t("dayPart.morning"),
    Afternoon: t("dayPart.afternoon"),
    Evening: t("dayPart.evening"),
  };

  return (
    <FieldSet>
      <FieldLegend variant="label">{t("form.time")}</FieldLegend>
      {slots === null || starts === null ? (
        <Muted>{t("form.loadingTimes")}</Muted>
      ) : slots.length === 0 && starts.length === 0 ? (
        <Muted>{t("form.noTimes")}</Muted>
      ) : (
        <>
          {slots.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s) => (
                <Choice key={s} selected={s === start} onClick={() => onPick(s)}>
                  {formats.time.format(new Date(s))}
                </Choice>
              ))}
            </div>
          )}
          {starts.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="self-start text-sm text-primary underline-offset-4 hover:underline"
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? t("form.hideOther") : t("form.otherStarts")}
              </button>
              {showAll && (
                <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  {groupByDayPart(starts, (s) => s.start, timeZone).map(({ part, items }) => (
                    <div key={part} className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{partLabel[part]}</span>
                      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                        {items.map((s) => (
                          <Choice key={s.start} selected={s.start === start} onClick={() => onPick(s.start)}>
                            {formats.time.format(new Date(s.start))}
                          </Choice>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </FieldSet>
  );
}

/** Duração do atendimento: as sugestões até o tempo livre, e o campo para digitar (45, 2h, 1h30). */
export function DurationField({
  formats,
  start,
  maxMinutes,
  minMinutes = MIN_DURATION,
  duration,
  onChange,
}: {
  formats: Formats;
  start: string;
  /** Tempo livre a partir do horário escolhido */
  maxMinutes: number;
  minMinutes?: number;
  duration: string;
  onChange: (duration: string) => void;
}) {
  const { t } = useTranslation("appointments");
  const durationError = validateDuration(duration, maxMinutes, minMinutes);
  const parsed = parseDuration(duration);

  /** Texto do erro da duração, no idioma atual do painel. */
  const durationErrorText = (e: DurationError): string => {
    switch (e.code) {
      case "format":
        return t("duration.error.format");
      case "min":
        return t("duration.error.min", { min: minMinutes });
      case "step":
        return t("duration.error.step");
      case "max":
        return t("duration.error.max", { max: formatMinutes(e.max ?? 0) });
    }
  };

  return (
    <FieldSet>
      <FieldLegend variant="label">{t("form.duration")}</FieldLegend>
      <div className="flex flex-wrap items-center gap-1.5">
        {durationPresets(maxMinutes).map((m) => (
          <Choice key={m} selected={parsed === m} onClick={() => onChange(formatMinutes(m))}>
            {formatMinutes(m)}
          </Choice>
        ))}
        <Input
          className="w-32"
          aria-label={t("form.durationLabel")}
          placeholder={t("form.durationPlaceholder")}
          inputMode="text"
          value={duration}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!durationError}
        />
      </div>
      <Muted>
        {durationError || parsed === null
          ? t("form.summaryFree", {
              freeUntil: formats.time.format(new Date(endOfRoom(start, maxMinutes))),
              max: formatMinutes(maxMinutes),
            })
          : t("form.summaryFull", {
              start: formats.time.format(new Date(start)),
              end: formats.time.format(new Date(Date.parse(start) + parsed * 60_000)),
              duration: formatMinutes(parsed),
              freeUntil: formats.time.format(new Date(endOfRoom(start, maxMinutes))),
              max: formatMinutes(maxMinutes),
            })}
      </Muted>
      {durationError && <Muted tone="destructive">{durationErrorText(durationError)}</Muted>}
    </FieldSet>
  );
}
