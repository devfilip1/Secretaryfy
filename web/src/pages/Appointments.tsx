import { useCallback, useEffect, useMemo, useState } from "react";
import { confirmAppointment, listAppointments, type Appointment, type ReminderLabel } from "../api";
import { NewAppointment } from "../components/NewAppointment";
import { blockReasonText, formatPhone } from "../format";
import { useInboxEvents } from "../useEvents";

const GROUPS: { key: Appointment["group"]; title: string }[] = [
  { key: "today", title: "Today" },
  { key: "tomorrow", title: "Tomorrow" },
  { key: "week", title: "Next 7 days" },
];

/** Etiqueta da situação do lembrete e da confirmação (specs/006 data-model.md); not_needed não mostra nada. */
function reminderTag(a: Appointment): { text: string; tone: "ok" | "warn" | "bad" | "muted"; title?: string } | null {
  const reason = blockReasonText(a.reminder.reason);
  const labels: Record<ReminderLabel, ReturnType<typeof reminderTag>> = {
    confirmed: { text: a.confirmedBy === "operator" ? "Confirmed by you" : "Confirmed", tone: "ok" },
    scheduled: { text: "Reminder scheduled", tone: "muted", title: "The WhatsApp reminder goes out from 24 h before." },
    remind_manually: { text: "Remind manually", tone: "warn", title: `${reason}. The assistant can't message this customer first.` },
    waiting: { text: "Reminder waiting", tone: "muted", title: reason },
    sent: { text: "Reminder sent", tone: "muted", title: "Waiting for the customer to reply YES." },
    not_sent: { text: "Reminder not sent", tone: "bad", title: reason },
    not_needed: null,
  };
  return labels[a.reminder.label];
}

/** Próximos horários marcados pelo assistente ou pelo painel (specs/006 US1). */
export function AppointmentsPage() {
  const [data, setData] = useState<{ timeZone: string; appointments: Appointment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    listAppointments()
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch(() => setError("Could not load the appointments."));
  }, []);
  useEffect(load, [load]);

  useInboxEvents((event) => {
    if (event.type === "appointments.updated" || event.type === "customers.updated" || event.type === "reconnected") load();
  });

  const formats = useMemo(() => {
    const timeZone = data?.timeZone;
    return {
      time: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }),
      day: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }),
    };
  }, [data?.timeZone]);

  async function confirm(a: Appointment) {
    setConfirming(a.id);
    try {
      const { appointment } = await confirmAppointment(a.id);
      setData((d) => d && { ...d, appointments: d.appointments.map((x) => (x.id === a.id ? appointment : x)) });
    } catch {
      setError(`Could not confirm ${a.customerName}'s appointment. Please try again.`);
    } finally {
      setConfirming(null);
    }
  }

  if (!data) return <main className="page muted">{error ?? "Loading…"}</main>;

  return (
    <main className="page">
      <div className="appointments-page">
        <section className="card wide">
          <div className="appointments-head">
            <div>
              <h2>Appointments</h2>
              <p className="muted small">Booked by the assistant or here, for the next 7 days.</p>
            </div>
            {!creating && (
              <button className="primary" onClick={() => setCreating(true)}>
                New appointment
              </button>
            )}
          </div>

          {notice && (
            <div className="flash ok" role="status">
              {notice}
              <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss notice">
                ×
              </button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {creating && (
            <NewAppointment
              onCancel={() => setCreating(false)}
              onBooked={(a) => {
                setCreating(false);
                setNotice(`Booked ${a.customerName} for ${formats.day.format(new Date(a.startsAt))} at ${formats.time.format(new Date(a.startsAt))}.`);
                load();
              }}
            />
          )}

          {data.appointments.length === 0 ? (
            <p className="muted empty">No appointments in the next 7 days.</p>
          ) : (
            GROUPS.map(({ key, title }) => {
              const items = data.appointments.filter((a) => a.group === key);
              if (items.length === 0) return null;
              return (
                <section key={key} className="appointment-group">
                  <h3>
                    {title} <span className="muted small">({items.length})</span>
                  </h3>
                  <ul className="appointment-list">
                    {items.map((a) => {
                      const tag = reminderTag(a);
                      const start = new Date(a.startsAt);
                      return (
                        <li key={a.id} className={a.reminder.label === "remind_manually" ? "attention" : ""}>
                          <div className="appointment-time">
                            <strong>{formats.time.format(start)}</strong>
                            {key === "week" && <span className="muted small">{formats.day.format(start)}</span>}
                          </div>
                          <div className="appointment-main">
                            <span className="appointment-name">{a.customerName}</span>
                            <span className="muted small">
                              {a.service ?? "—"} · {formatPhone(a.phone)}
                              {a.origin === "panel" ? " · booked here" : ""}
                            </span>
                            {a.notes && <span className="appointment-notes">📝 {a.notes}</span>}
                          </div>
                          <div className="appointment-side">
                            {tag && (
                              <span className={`tag ${tag.tone}`} title={tag.title}>
                                {tag.text}
                              </span>
                            )}
                            <div className="appointment-actions">
                              {!a.confirmedAt && (
                                <button
                                  className={a.reminder.label === "remind_manually" ? "primary" : ""}
                                  onClick={() => confirm(a)}
                                  disabled={confirming === a.id}
                                  title="Mark as confirmed (for example, after calling the customer)"
                                >
                                  {confirming === a.id ? "Confirming…" : "Confirm"}
                                </button>
                              )}
                              {a.conversationId && <a href={`#/?c=${a.conversationId}`}>Open conversation</a>}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
