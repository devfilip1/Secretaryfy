import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, bookingDays, bookingSlots, createAppointment, lookupPhone, type Appointment } from "../api";

/** Os serviços do assistente (src/modules/scheduling/services.ts), na mesma ordem. */
const SERVICES = [
  "Dental Cleaning",
  "Teeth Whitening",
  "Dental Filling",
  "Root Canal Treatment",
  "Dental Implants",
  "Braces and Orthodontic Treatment",
  "Tooth Extraction",
  "Dental Veneers",
  "Assessment",
];
const serviceLabel = (s: string) => (s === "Assessment" ? "General assessment" : s);

/** Marcação pelo painel para quem ligou (specs/006 US3): só horários livres, calculados como o assistente calcula. */
export function NewAppointment({ onBooked, onCancel }: { onBooked: (a: Appointment) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [service, setService] = useState(SERVICES[0]);
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

  const formats = useMemo(
    () => ({
      day: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }),
      time: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }),
    }),
    [timeZone],
  );
  // Dias vêm como YYYY-MM-DD no fuso da clínica: o meio-dia UTC cai no mesmo dia em qualquer fuso do Brasil
  const dayLabel = (d: string) => formats.day.format(new Date(`${d}T12:00:00Z`));

  function calendarError(err: unknown) {
    if (err instanceof ApiError && err.error === "calendar_disconnected") setDisconnected(true);
    else setError("Could not reach Google Calendar. Please try again.");
  }

  useEffect(() => {
    bookingDays()
      .then((r) => {
        setTimeZone(r.timeZone);
        setDays(r.days);
      })
      .catch(calendarError);
  }, []);

  useEffect(() => {
    if (!day) return;
    setSlots(null);
    setStart(null);
    bookingSlots(day).then((r) => setSlots(r.slots), calendarError);
  }, [day]);

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
      <div className="flash bad new-appointment">
        Google Calendar is not connected. <a href="#/calendar">Connect it in Calendar</a> to book appointments.
        <button className="link" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  const canBook = Boolean(phone.trim() && name.trim() && start && !existing && !busy);

  return (
    <form className="new-appointment" onSubmit={submit}>
      <h3>New appointment</h3>
      <div className="fields">
        <label className="field">
          Phone
          <input
            type="tel"
            inputMode="tel"
            placeholder="(71) 99999-9999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={checkPhone}
            aria-invalid={!!phoneError}
          />
          {phoneError && <span className="error small">{phoneError}</span>}
        </label>
        <label className="field">
          Name
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Service
          <select value={service} onChange={(e) => setService(e.target.value)}>
            {SERVICES.map((s) => (
              <option key={s} value={s}>
                {serviceLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {existing && (
        <div className="flash bad">
          This customer already has an appointment on {formats.day.format(new Date(existing.startsAt))} at{" "}
          {formats.time.format(new Date(existing.startsAt))}. Only one future appointment per number.
        </div>
      )}

      <div className="field">
        Day
        {days === null ? (
          <span className="muted small">Loading available days…</span>
        ) : days.length === 0 ? (
          <span className="muted small">No available days within the booking window.</span>
        ) : (
          <div className="choice-grid">
            {days.map((d) => (
              <button type="button" key={d} className={d === day ? "selected" : ""} onClick={() => setDay(d)}>
                {dayLabel(d)}
              </button>
            ))}
          </div>
        )}
      </div>

      {day && (
        <div className="field">
          Time
          {slots === null ? (
            <span className="muted small">Loading times…</span>
          ) : slots.length === 0 ? (
            <span className="muted small">No free times on this day anymore.</span>
          ) : (
            <div className="choice-grid">
              {slots.map((s) => (
                <button type="button" key={s} className={s === start ? "selected" : ""} onClick={() => setStart(s)}>
                  {formats.time.format(new Date(s))}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="primary" type="submit" disabled={!canBook}>
          {busy ? "Booking…" : "Book"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <span className="muted small">No message is sent to the customer.</span>
      </div>
    </form>
  );
}
