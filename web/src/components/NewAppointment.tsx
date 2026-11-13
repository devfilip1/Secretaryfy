import { useEffect, useState, type FormEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ApiError, bookingDays, bookingSlots, bookingStarts, createAppointment, listServices, lookupPhone, type Appointment, type BookingStart } from "../api";
import { useInboxEvents } from "../useEvents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormats } from "../i18n/formats";
import { useActivePanelLanguage } from "../i18n/usePanelLanguage";
import { defaultDuration, formatMinutes, parseDuration, validateDuration } from "./duration";
import { DayField, DurationField, StartField, type DayRange } from "./booking-pickers";
import { Field } from "./Field";
import { Muted } from "./Muted";
import { Notice } from "./Notice";
import { Title } from "./Title";

/** Marcação pelo painel para quem ligou (specs/006 US3): só horários livres, calculados como o assistente calcula. */
export function NewAppointment({ onBooked, onCancel }: { onBooked: (a: Appointment) => void; onCancel: () => void }) {
  const { t } = useTranslation("appointments");
  const language = useActivePanelLanguage();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [services, setServices] = useState<{ name: string; label: string }[] | null>(null);
  const [service, setService] = useState("");
  const [timeZone, setTimeZone] = useState<string | undefined>();
  const [days, setDays] = useState<string[] | null>(null);
  const [range, setRange] = useState<DayRange | null>(null);
  // Estado de cada dia aberto (até um ano) para o serviço escolhido: livre (verde) ou lotado (vermelho)
  const [status, setStatus] = useState<Record<string, "free" | "full">>({});
  const [daysReload, setDaysReload] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  // Duração usada para os horários sugeridos (a do serviço)
  const [slotMinutes, setSlotMinutes] = useState(0);
  // Todos os inícios livres do dia, com o tempo livre de cada um
  const [starts, setStarts] = useState<BookingStart[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  // Texto do campo de duração; começa em branco e é preenchido quando um horário é escolhido
  const [duration, setDuration] = useState("");
  const [existing, setExisting] = useState<Appointment | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slotsReload, setSlotsReload] = useState(0);

  const formats = useFormats(timeZone);

  function calendarError(err: unknown) {
    if (err instanceof ApiError && err.error === "calendar_disconnected") setDisconnected(true);
    else setError(t("errors.calendar"));
  }

  // Serviços e dias são recarregados também ao reconectar: se o formulário abriu sem conexão, não pode ficar sem dados
  function loadServices() {
    listServices(language)
      .then((r) => {
        setServices(r.services);
        // Mantém o serviço já escolhido se ele ainda existir; senão começa pelo primeiro
        setService((current) => (r.services.some((s) => s.name === current) ? current : (r.services[0]?.name ?? "")));
      })
      .catch(() => setError(t("errors.services")));
  }

  // Trocar o idioma do painel recarrega os rótulos dos serviços (o servidor os devolve no idioma pedido)
  useEffect(() => {
    loadServices();
  }, [language]);

  // Os dias dependem do serviço (a duração do atendimento). Espera a lista de serviços: o padrão já está escolhido
  // nessa hora, então carrega uma vez só. Reconectar recarrega pelo contador `daysReload`.
  const servicesReady = services !== null;
  useEffect(() => {
    if (!servicesReady) return;
    let stale = false;
    bookingDays({ service: service || undefined })
      .then((r) => {
        if (stale) return;
        setTimeZone(r.timeZone);
        setDays(r.days);
        setRange({ minDate: r.minDate, maxDate: r.maxDate });
        setStatus(r.status);
      })
      .catch((err) => {
        if (!stale) calendarError(err);
      });
    return () => {
      stale = true;
    };
  }, [servicesReady, service, daysReload]);

  // Ao reconectar, limpa o erro e recarrega; os contadores fazem os effects de dias e horários rodar de novo
  useInboxEvents((event) => {
    if (event.type !== "reconnected") return;
    setError(null);
    setDisconnected(false);
    loadServices();
    setDaysReload((n) => n + 1);
    setSlotsReload((n) => n + 1);
  });

  useEffect(() => {
    if (!day) return;
    let stale = false;
    setSlots(null);
    setStarts(null);
    setStart(null);
    // O tempo do atendimento depende do serviço: trocar o serviço traz os horários dele. Os inícios livres vêm junto.
    Promise.all([bookingSlots({ date: day, service: service || undefined }), bookingStarts({ date: day })]).then(
      ([suggested, all]) => {
        if (stale) return;
        setSlots(suggested.slots);
        setSlotMinutes(suggested.minutes);
        setStarts(all.starts);
      },
      (err) => {
        if (!stale) calendarError(err);
      },
    );
    return () => {
      stale = true;
    };
  }, [day, service, slotsReload]);

  // Tempo livre do início escolhido. Um início fora da lista não existe; se acontecer, vale a duração do serviço.
  const chosen = start ? starts?.find((s) => s.start === start) : undefined;
  const maxMinutes = start ? (chosen?.maxMinutes ?? slotMinutes) : 0;
  const durationError = start ? validateDuration(duration, maxMinutes) : null;
  const parsed = parseDuration(duration);

  // Escolher um horário (chip ou lista) põe a duração padrão dele
  function pickStart(next: string) {
    const found = starts?.find((s) => s.start === next);
    setStart(next);
    setDuration(formatMinutes(defaultDuration(slotMinutes, found?.maxMinutes ?? slotMinutes)));
  }

  async function checkPhone() {
    setExisting(null);
    setPhoneError(null);
    if (!phone.trim()) return;
    try {
      const found = await lookupPhone(phone, language);
      setPhone(found.phone);
      if (found.name && !name.trim()) setName(found.name);
      setExisting(found.futureAppointment);
    } catch (err) {
      if (err instanceof ApiError && err.error === "invalid_phone") setPhoneError(t("errors.invalid_phone"));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!start || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { appointment } = await createAppointment({ phone, name, service, start, minutes: parseDuration(duration) ?? 0 }, language);
      onBooked(appointment);
    } catch (err) {
      if (err instanceof ApiError && err.error === "slot_taken") {
        setError(t("errors.slot_taken"));
        setStart(null);
        setSlots(err.body.slots as string[]);
        // Recarrega também a lista completa: o horário ocupado e o tempo livre dos outros mudaram
        setSlotsReload((n) => n + 1);
      } else if (err instanceof ApiError && err.error === "already_booked") {
        setExisting(err.body.appointment as Appointment);
      } else if (err instanceof ApiError && err.error === "invalid_body") {
        setError(t("errors.invalid_body"));
      } else {
        calendarError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  if (disconnected) {
    return (
      <Notice layout="box" tone="plain">
        <Trans i18nKey="form.disconnected" ns="appointments" components={{ link: <a href="#/calendar" /> }} />
        <Button variant="link" onClick={onCancel}>
          {t("close")}
        </Button>
      </Notice>
    );
  }

  const canBook = Boolean(services && service && phone.trim() && name.trim() && start && !durationError && !existing && !busy);

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Title level={3}>{t("form.title")}</Title>
      <div className="grid items-start gap-3 md:grid-cols-2">
        <Field>
          {t("form.phone")}
          <Input
            type="tel"
            inputMode="tel"
            placeholder="(71) 99999-9999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={checkPhone}
            aria-invalid={!!phoneError}
          />
          {phoneError && <Muted tone="destructive">{phoneError}</Muted>}
        </Field>
        <Field>
          {t("form.name")}
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          {t("form.service")}
          <Select value={service} onValueChange={setService}>
            <SelectTrigger>
              <SelectValue placeholder={services === null ? t("form.loadingServices") : undefined} />
            </SelectTrigger>
            <SelectContent>
              {services?.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {existing && (
        <Notice layout="box" tone="destructive">
          {t("form.existing", {
            day: formats.day.format(new Date(existing.startsAt)),
            time: formats.time.format(new Date(existing.startsAt)),
          })}
        </Notice>
      )}

      <DayField formats={formats} days={days} range={range} status={status} day={day} onPick={setDay} />

      {day && <StartField formats={formats} timeZone={timeZone} slots={slots} starts={starts} start={start} onPick={pickStart} />}

      {start && <DurationField formats={formats} start={start} maxMinutes={maxMinutes} duration={duration} onChange={setDuration} />}

      {error && <Notice role="alert">{error}</Notice>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Muted className="mr-auto">{t("form.noMessage")}</Muted>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={!canBook}>
          {busy ? t("form.booking") : t("book")}
        </Button>
      </div>
    </form>
  );
}
