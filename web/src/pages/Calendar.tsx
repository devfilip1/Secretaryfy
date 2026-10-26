import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  connectCalendar,
  disconnectCalendar,
  getCalendar,
  listCalendars,
  saveRules,
  selectCalendar,
  type CalendarConnection,
  type CalendarOption,
  type CalendarRules,
  type DayKey,
  type RulesIssue,
} from "../api";
import { useInboxEvents } from "../useEvents";

const DAYS: { key: DayKey; label: string }[] = [
  { key: "1", label: "Monday" },
  { key: "2", label: "Tuesday" },
  { key: "3", label: "Wednesday" },
  { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" },
  { key: "6", label: "Saturday" },
  { key: "7", label: "Sunday" },
];

/** Avisos da volta do Google (?google=... no hash, contracts/panel-api.md). */
const OAUTH_NOTICES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Calendar connected.", ok: true },
  denied: { text: "Authorization was cancelled on the Google screen. Nothing changed.", ok: false },
  error: { text: "Could not connect the calendar. Please try again.", ok: false },
  missing_scope: {
    text: "Calendar access was not authorized. Connect again and keep all permissions checked.",
    ok: false,
  },
};

/** Lê e limpa o ?google= do hash. */
function takeOAuthNotice() {
  const [path, query] = window.location.hash.split("?");
  const outcome = new URLSearchParams(query).get("google");
  if (outcome) history.replaceState(null, "", path);
  return outcome ? (OAUTH_NOTICES[outcome] ?? null) : null;
}

export function CalendarPage() {
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [rules, setRules] = useState<CalendarRules | null>(null);
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null);
  const [notice, setNotice] = useState(takeOAuthNotice);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getCalendar()
      .then((s) => {
        setConnection(s.connection);
        setRules((current) => current ?? s.rules);
      })
      .catch(() => setError("Could not load the calendar."));
  }, []);
  useEffect(load, [load]);

  useInboxEvents((event) => {
    if (event.type === "calendar.updated") setConnection(event.connection);
    if (event.type === "reconnected") load();
  });

  // Agendas da conta, para escolher (só conectada)
  const connected = connection?.status === "connected";
  useEffect(() => {
    if (!connected) return setCalendars(null);
    listCalendars()
      .then((r) => setCalendars(r.calendars))
      .catch(() => setCalendars([]));
  }, [connected, connection?.email]);

  async function connect() {
    setBusy(true);
    try {
      window.location.href = (await connectCalendar()).url;
    } catch (err) {
      setError(
        err instanceof ApiError && err.error === "google_not_configured"
          ? "Google credentials are not configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env with the ones from Google Cloud Console and restart the server."
          : "Could not start the connection with Google.",
      );
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect the calendar? The assistant stops offering and booking times until you connect again.")) return;
    setBusy(true);
    try {
      await disconnectCalendar();
      load();
    } catch {
      setError("Could not disconnect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function choose(calendarId: string) {
    try {
      setConnection((await selectCalendar(calendarId)).connection);
    } catch {
      setError("Could not change the calendar.");
    }
  }

  if (!connection || !rules) return <main className="page muted">{error ?? "Loading…"}</main>;

  return (
    <main className="page">
      <div className="calendar-page">
        {notice && (
          <div className={`flash ${notice.ok ? "ok" : "bad"}`} role="status">
            {notice.text}
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

        <section className="card wide">
          <h2>Google Calendar</h2>
          {connection.status === "disconnected" ? (
            <>
              <p className="muted">
                Connect the clinic calendar so the assistant can check free times and book appointments over
                WhatsApp.
              </p>
              <button className="primary" onClick={connect} disabled={busy}>
                Connect Google Calendar
              </button>
            </>
          ) : (
            <>
              {connection.status === "needs_reauth" && (
                <div className="flash bad">
                  Google denied access to the calendar. Reconnect so the assistant can book again.
                  <button className="primary" onClick={connect} disabled={busy}>
                    Reconnect
                  </button>
                </div>
              )}
              <p>
                Account: <strong>{connection.email}</strong>
                <br />
                <span className="muted small">
                  Time zone: <strong>{connection.timeZone}</strong>
                </span>
              </p>
              {/^(UTC|Etc\/)/.test(connection.timeZone) && (
                <div className="flash bad">
                  The calendar is set to {connection.timeZone}: times offered to customers will be calculated in that zone.
                  Change the time zone in the Google Calendar settings and reload this page.
                </div>
              )}
              <label className="field">
                Calendar used for bookings
                <select
                  value={connection.calendarId}
                  onChange={(e) => choose(e.target.value)}
                  disabled={!calendars || calendars.length === 0}
                >
                  {(calendars ?? [{ id: connection.calendarId, name: connection.calendarName, timeZone: "", primary: false }]).map(
                    (c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.primary ? " (primary)" : ""}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button className="danger" onClick={disconnect} disabled={busy}>
                Disconnect
              </button>
            </>
          )}
        </section>

        <RulesForm initial={rules} onSaved={setRules} />
      </div>
    </main>
  );
}

/** Regras de atendimento (FR-007, FR-008). Os prazos aparecem em horas e vão para a API em minutos. */
function RulesForm({ initial, onSaved }: { initial: CalendarRules; onSaved: (r: CalendarRules) => void }) {
  const [rules, setRules] = useState(initial);
  const [issues, setIssues] = useState<RulesIssue[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const issueAt = (path: string) => issues.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message;

  function setDay(key: DayKey, patch: Partial<{ start: string; end: string }> | null) {
    setRules((r) => {
      const weeklyHours = { ...r.weeklyHours };
      if (patch === null) delete weeklyHours[key];
      else weeklyHours[key] = { start: "09:00", end: "18:00", ...weeklyHours[key], ...patch };
      return { ...r, weeklyHours };
    });
    setStatus("idle");
  }

  const setNumber = (field: Exclude<keyof CalendarRules, "weeklyHours">, value: number) => {
    setRules((r) => ({ ...r, [field]: value }));
    setStatus("idle");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    try {
      const saved = (await saveRules(rules)).rules;
      setIssues([]);
      setRules(saved);
      onSaved(saved);
      setStatus("saved");
    } catch (err) {
      if (err instanceof ApiError && err.error === "invalid_rules") setIssues(err.body.issues as RulesIssue[]);
      setStatus("error");
    }
  }

  return (
    <form className="card wide rules" onSubmit={submit}>
      <h2>Business hours</h2>
      <p className="muted small">The assistant only offers times within these rules that are free on the calendar.</p>

      <div className="week">
        {DAYS.map(({ key, label }) => {
          const hours = rules.weeklyHours[key];
          const problem = issueAt(`weeklyHours.${key}`);
          return (
            <div key={key} className="day-row">
              <label className="check">
                <input type="checkbox" checked={!!hours} onChange={(e) => setDay(key, e.target.checked ? {} : null)} />
                {label}
              </label>
              {hours ? (
                <>
                  <input
                    type="time"
                    aria-label={`${label}: start`}
                    value={hours.start}
                    onChange={(e) => setDay(key, { start: e.target.value })}
                  />
                  <span className="muted">to</span>
                  <input
                    type="time"
                    aria-label={`${label}: end`}
                    value={hours.end}
                    onChange={(e) => setDay(key, { end: e.target.value })}
                  />
                </>
              ) : (
                <span className="muted small">Closed</span>
              )}
              {problem && <span className="error small">{problem}</span>}
            </div>
          );
        })}
        {issueAt("weeklyHours") && !DAYS.some((d) => issueAt(`weeklyHours.${d.key}`)) && (
          <p className="error small">{issueAt("weeklyHours")}</p>
        )}
      </div>

      <div className="fields">
        <NumberField label="Appointment length (min)" value={rules.slotMinutes} step={5} error={issueAt("slotMinutes")}
          onChange={(v) => setNumber("slotMinutes", v)} />
        <NumberField label="Minimum notice to book (h)" value={rules.minNoticeMinutes / 60} step={0.5}
          error={issueAt("minNoticeMinutes")} onChange={(v) => setNumber("minNoticeMinutes", Math.round(v * 60))} />
        <NumberField label="Book up to how many days ahead" value={rules.maxDaysAhead} step={1}
          error={issueAt("maxDaysAhead")} onChange={(v) => setNumber("maxDaysAhead", v)} />
        <NumberField label="Cancel or reschedule up to (h before)" value={rules.cancelNoticeMinutes / 60} step={1}
          error={issueAt("cancelNoticeMinutes")} onChange={(v) => setNumber("cancelNoticeMinutes", Math.round(v * 60))} />
      </div>

      <div className="form-actions">
        <button className="primary" type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save rules"}
        </button>
        {status === "saved" && <span className="ok-text small">Rules saved.</span>}
        {status === "error" && <span className="error small">Check the highlighted fields.</span>}
      </div>
    </form>
  );
}

function NumberField(props: { label: string; value: number; step: number; error?: string; onChange: (v: number) => void }) {
  return (
    <label className="field">
      {props.label}
      <input
        type="number"
        min={0}
        step={props.step}
        value={Number.isFinite(props.value) ? props.value : ""}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
        aria-invalid={!!props.error}
      />
      {props.error && <span className="error small">{props.error}</span>}
    </label>
  );
}
