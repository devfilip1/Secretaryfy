import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { ApiError, bookingDays, bookingSlots, createAppointment, listServices, lookupPhone, type Appointment } from "../api";
import { useInboxEvents } from "../useEvents";
import { Button } from "@/components/ui/button";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clinicFormats } from "../format";
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
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [existing, setExisting] = useState<Appointment | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slotsReload, setSlotsReload] = useState(0);

  const formats = useMemo(() => clinicFormats(timeZone), [timeZone]);
  // Dias vêm como YYYY-MM-DD no fuso da clínica: o meio-dia UTC cai no mesmo dia em qualquer fuso do Brasil
  const dayLabel = (d: string) => formats.day.format(new Date(`${d}T12:00:00Z`));

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

  function loadDays() {
    bookingDays()
      .then((r) => {
        setTimeZone(r.timeZone);
        setDays(r.days);
      })
      .catch(calendarError);
  }

  useEffect(() => {
    loadServices();
  }, []);

  useEffect(() => {
    loadDays();
  }, []);

  // Ao reconectar, limpa o erro e recarrega; o contador faz o effect de horários rodar de novo
  useInboxEvents((event) => {
    if (event.type !== "reconnected") return;
    setError(null);
    setDisconnected(false);
    loadServices();
    loadDays();
    setSlotsReload((n) => n + 1);
  });

  useEffect(() => {
    if (!day) return;
    setSlots(null);
    setStart(null);
    // O tempo do atendimento depende do serviço: trocar o serviço traz os horários dele
    bookingSlots(day, service || undefined).then((r) => setSlots(r.slots), calendarError);
  }, [day, service, slotsReload]);

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
      const { appointment } = await createAppointment({ phone, name, service, start });
      onBooked(appointment);
    } catch (err) {
      if (err instanceof ApiError && err.error === "slot_taken") {
        setError("That time was just taken. Pick another one.");
        setStart(null);
        setSlots(err.body.slots as string[]);
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

  const canBook = Boolean(services && service && phone.trim() && name.trim() && start && !existing && !busy);

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
      </FieldSet>

      {day && (
        <FieldSet>
          <FieldLegend variant="label">Time</FieldLegend>
          {slots === null ? (
            <Muted>Loading times…</Muted>
          ) : slots.length === 0 ? (
            <Muted>No free times on this day anymore.</Muted>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s) => (
                <Choice key={s} selected={s === start} onClick={() => setStart(s)}>
                  {formats.time.format(new Date(s))}
                </Choice>
              ))}
            </div>
          )}
        </FieldSet>
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
