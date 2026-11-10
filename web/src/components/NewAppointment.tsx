import { useEffect, useId, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { ApiError, bookingDays, bookingSlots, bookingStarts, createAppointment, listServices, lookupPhone, type Appointment, type BookingStart } from "../api";
import { useInboxEvents } from "../useEvents";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clinicFormats } from "../format";
import { toDate, toYmd } from "./date-string";
import { defaultDuration, endOfRoom, formatMinutes, validateDuration } from "./duration";
import { Field } from "./Field";
import { Muted } from "./Muted";
import { Notice } from "./Notice";
import { Title } from "./Title";

/** Horário ou dia escolhido: o selecionado fica preenchido (primary); os outros ficam secundários. */
function Choice({ selected, ...props }: ComponentProps<typeof Button> & { selected: boolean }) {
  return <Button type="button" size="sm" variant={selected ? "default" : "secondary"} {...props} />;
}

/** Marcação pelo painel para quem ligou (specs/006 US3): só horários livres, calculados como o assistente calcula. */
export function NewAppointment({ onBooked, onCancel }: { onBooked: (a: Appointment) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [services, setServices] = useState<{ name: string; label: string }[] | null>(null);
  const [service, setService] = useState("");
  const [timeZone, setTimeZone] = useState<string | undefined>();
  const [days, setDays] = useState<string[] | null>(null);
  const [range, setRange] = useState<{ minDate: string; maxDate: string } | null>(null);
  // Estado de cada dia aberto (até um ano) para o serviço escolhido: livre (verde) ou lotado (vermelho)
  const [status, setStatus] = useState<Record<string, "free" | "full">>({});
  const [daysReload, setDaysReload] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const otherDateId = useId();
  const [slots, setSlots] = useState<string[] | null>(null);
  // Duração usada para os horários sugeridos (a do serviço)
  const [slotMinutes, setSlotMinutes] = useState(0);
  // Todos os inícios livres do dia, com o tempo livre de cada um
  const [starts, setStarts] = useState<BookingStart[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  // Texto do campo "Duration (minutes)"; começa em branco e é preenchido quando um horário é escolhido
  const [duration, setDuration] = useState("");
  const [existing, setExisting] = useState<Appointment | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slotsReload, setSlotsReload] = useState(0);

  const formats = useMemo(() => clinicFormats(timeZone), [timeZone]);
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

  function calendarError(err: unknown) {
    if (err instanceof ApiError && err.error === "calendar_disconnected") setDisconnected(true);
    else setError("Could not reach Google Calendar. Please try again.");
  }

  // Serviços e dias são recarregados também ao reconectar: se o formulário abriu sem conexão, não pode ficar sem dados
  function loadServices() {
    listServices()
      .then((r) => {
        setServices(r.services);
        // Mantém o serviço já escolhido se ele ainda existir; senão começa pelo primeiro
        setService((current) => (r.services.some((s) => s.name === current) ? current : (r.services[0]?.name ?? "")));
      })
      .catch(() => setError("Could not load the services. Close the form and try again."));
  }

  useEffect(() => {
    loadServices();
  }, []);

  // Os dias dependem do serviço (a duração do atendimento). Espera a lista de serviços: o padrão já está escolhido
  // nessa hora, então carrega uma vez só. Reconectar recarrega pelo contador `daysReload`.
  const servicesReady = services !== null;
  useEffect(() => {
    if (!servicesReady) return;
    let stale = false;
    bookingDays(service || undefined)
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
    Promise.all([bookingSlots(day, service || undefined), bookingStarts(day)]).then(
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

  // Escolher um horário (chip ou lista) põe a duração padrão dele
  function pickStart(next: string) {
    const found = starts?.find((s) => s.start === next);
    setStart(next);
    setDuration(String(defaultDuration(slotMinutes, found?.maxMinutes ?? slotMinutes)));
  }

  async function checkPhone() {
    setExisting(null);
    setPhoneError(null);
    if (!phone.trim()) return;
    try {
      const found = await lookupPhone(phone);
      setPhone(found.phone);
      if (found.name && !name.trim()) setName(found.name);
      setExisting(found.futureAppointment);
    } catch (err) {
      if (err instanceof ApiError && err.error === "invalid_phone") setPhoneError("Enter a phone number with area code.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!start || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { appointment } = await createAppointment({ phone, name, service, start, minutes: Number(duration) });
      onBooked(appointment);
    } catch (err) {
      if (err instanceof ApiError && err.error === "slot_taken") {
        setError("That time was just taken. Pick another one.");
        setStart(null);
        setSlots(err.body.slots as string[]);
        // Recarrega também a lista completa: o horário ocupado e o tempo livre dos outros mudaram
        setSlotsReload((n) => n + 1);
      } else if (err instanceof ApiError && err.error === "already_booked") {
        setExisting(err.body.appointment as Appointment);
      } else if (err instanceof ApiError && err.error === "invalid_body") {
        const issues = err.body.issues as { path: string; message: string }[];
        setError(issues.map((i) => i.message).join(" · "));
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
        Google Calendar is not connected. <a href="#/calendar">Connect it in Calendar</a> to book appointments.
        <Button variant="link" onClick={onCancel}>
          Close
        </Button>
      </Notice>
    );
  }

  const canBook = Boolean(services && service && phone.trim() && name.trim() && start && !durationError && !existing && !busy);

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Title level={3}>New appointment</Title>
      <div className="grid gap-3 md:grid-cols-2">
        <Field>
          Phone
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
          Name
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          Service
          <Select value={service} onValueChange={setService}>
            <SelectTrigger>
              <SelectValue placeholder={services === null ? "Loading services…" : undefined} />
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
          This customer already has an appointment on {formats.day.format(new Date(existing.startsAt))} at{" "}
          {formats.time.format(new Date(existing.startsAt))}. Only one future appointment per number.
        </Notice>
      )}

      <FieldSet>
        <FieldLegend variant="label">Day</FieldLegend>
        {days === null ? (
          <Muted>Loading available days…</Muted>
        ) : days.length === 0 ? (
          <Muted>No available days within the booking window.</Muted>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => (
              <Choice key={d} selected={d === day} onClick={() => setDay(d)}>
                {dayLabel(d)}
              </Choice>
            ))}
          </div>
        )}
        {range && (
          // Outra data (até um ano à frente): o mesmo `day` dos chips, então o chip e o calendário mostram sempre o mesmo dia
          <div className="grid gap-1">
            <Label htmlFor={otherDateId}>Other date</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button id={otherDateId} variant="outline" className="w-full justify-start font-normal sm:w-auto">
                  <CalendarIcon />
                  {day ? dayLabel(day) : "Pick a date"}
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
                    setDay(toYmd(picked));
                    setPickerOpen(false);
                  }}
                />
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2">
                  <Muted className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
                    Free times
                  </Muted>
                  <Muted className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
                    Fully booked
                  </Muted>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </FieldSet>

      {day && (
        <FieldSet>
          <FieldLegend variant="label">Time</FieldLegend>
          {slots === null || starts === null ? (
            <Muted>Loading times…</Muted>
          ) : slots.length === 0 && starts.length === 0 ? (
            <Muted>No free times on this day anymore.</Muted>
          ) : (
            <>
              {slots.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((s) => (
                    <Choice key={s} selected={s === start} onClick={() => pickStart(s)}>
                      {formats.time.format(new Date(s))}
                    </Choice>
                  ))}
                </div>
              )}
              {starts.length > 0 && (
                <Field>
                  All times
                  <Select value={start ?? ""} onValueChange={pickStart}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick any free time" />
                    </SelectTrigger>
                    <SelectContent>
                      {starts.map((s) => (
                        <SelectItem key={s.start} value={s.start}>
                          {`${formats.time.format(new Date(s.start))}, up to ${formatMinutes(s.maxMinutes)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </>
          )}
        </FieldSet>
      )}

      {start && (
        <Field>
          Duration (minutes)
          <Input
            type="number"
            inputMode="numeric"
            min={5}
            max={maxMinutes}
            step={5}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            aria-invalid={!!durationError}
          />
          <Muted>
            {`Free until ${formats.time.format(new Date(endOfRoom(start, maxMinutes)))} (up to ${formatMinutes(maxMinutes)})`}
          </Muted>
          {durationError && <Muted tone="destructive">{durationError}</Muted>}
        </Field>
      )}

      {error && <Notice role="alert">{error}</Notice>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Muted className="mr-auto">No message is sent to the customer.</Muted>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canBook}>
          {busy ? "Booking…" : "Book"}
        </Button>
      </div>
    </form>
  );
}
