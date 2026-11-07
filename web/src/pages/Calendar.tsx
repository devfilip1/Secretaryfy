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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "../components/Field";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";
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

  if (!connection || !rules) return <Page className="text-muted-foreground">{error ?? "Loading…"}</Page>;

  return (
    <Page>
      <div className="grid w-[min(720px,100%)] gap-4 max-md:gap-3">
        {notice && (
          <Notice layout="box" tone={notice.ok ? "ok" : "destructive"} role="status" onDismiss={() => setNotice(null)}>
            {notice.text}
          </Notice>
        )}
        {error && <Notice role="alert">{error}</Notice>}

        <Card as="section" className="w-full">
          <Title level={2} className="mb-3">
            Google Calendar
          </Title>
          {connection.status === "disconnected" ? (
            <>
              <p className="my-4 text-muted-foreground">
                Connect the clinic calendar so the assistant can check free times and book appointments over WhatsApp.
              </p>
              <Button onClick={connect} disabled={busy}>
                Connect Google Calendar
              </Button>
            </>
          ) : (
            <>
              {connection.status === "needs_reauth" && (
                <Notice layout="box" tone="destructive" className="mb-3">
                  Google denied access to the calendar. Reconnect so the assistant can book again.
                  <Button onClick={connect} disabled={busy}>
                    Reconnect
                  </Button>
                </Notice>
              )}
              <p className="my-4">
                Account: <strong>{connection.email}</strong>
                <br />
                <Muted>
                  Time zone: <strong>{connection.timeZone}</strong>
                </Muted>
              </p>
              {/^(UTC|Etc\/)/.test(connection.timeZone) && (
                <Notice layout="box" tone="destructive" className="mb-3">
                  The calendar is set to {connection.timeZone}: times offered to customers will be calculated in that zone. Change the
                  time zone in the Google Calendar settings and reload this page.
                </Notice>
              )}
              <Field className="my-3">
                Calendar used for bookings
                <Select value={connection.calendarId} onValueChange={choose} disabled={!calendars || calendars.length === 0}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(calendars ?? [{ id: connection.calendarId, name: connection.calendarName, timeZone: "", primary: false }]).map(
                      (c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.primary ? " (primary)" : ""}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Button variant="destructive" onClick={disconnect} disabled={busy}>
                Disconnect
              </Button>
            </>
          )}
        </Card>

        <RulesForm initial={rules} onSaved={setRules} />
      </div>
    </Page>
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
    <Card as="form" className="w-full" onSubmit={submit}>
      <Title level={2} className="mb-1">
        Business hours
      </Title>
      <Muted as="p" className="my-4">
        The assistant only offers times within these rules that are free on the calendar.
      </Muted>

      <div className="my-3 grid gap-1.5">
        {DAYS.map(({ key, label }) => {
          const hours = rules.weeklyHours[key];
          const problem = issueAt(`weeklyHours.${key}`);
          return (
            <div
              key={key}
              className="grid min-h-9.5 grid-cols-[130px_auto_auto_auto_1fr] items-center gap-2 max-md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] max-md:gap-x-2 max-md:gap-y-1 max-md:border-b max-md:py-1.5"
            >
              <label className="flex items-center gap-2 max-md:col-span-full">
                <input type="checkbox" checked={!!hours} onChange={(e) => setDay(key, e.target.checked ? {} : null)} />
                {label}
              </label>
              {hours ? (
                <>
                  <Input
                    type="time"
                    aria-label={`${label}: start`}
                    className="w-auto max-md:w-full"
                    value={hours.start}
                    onChange={(e) => setDay(key, { start: e.target.value })}
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="time"
                    aria-label={`${label}: end`}
                    className="w-auto max-md:w-full"
                    value={hours.end}
                    onChange={(e) => setDay(key, { end: e.target.value })}
                  />
                </>
              ) : (
                <Muted className="max-md:col-span-full">Closed</Muted>
              )}
              {problem && (
                <Muted tone="destructive" className="max-md:col-span-full">
                  {problem}
                </Muted>
              )}
            </div>
          );
        })}
        {issueAt("weeklyHours") && !DAYS.some((d) => issueAt(`weeklyHours.${d.key}`)) && (
          <Muted as="p" tone="destructive">
            {issueAt("weeklyHours")}
          </Muted>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-4">
        <NumberField
          label="Default appointment length (min)"
          value={rules.slotMinutes}
          step={5}
          error={issueAt("slotMinutes")}
          onChange={(v) => setNumber("slotMinutes", v)}
        />
        <NumberField
          label="Time grid (min)"
          value={rules.gridMinutes}
          step={5}
          error={issueAt("gridMinutes")}
          onChange={(v) => setNumber("gridMinutes", v)}
        />
        <NumberField
          label="Minimum notice to book (h)"
          value={rules.minNoticeMinutes / 60}
          step={0.5}
          error={issueAt("minNoticeMinutes")}
          onChange={(v) => setNumber("minNoticeMinutes", Math.round(v * 60))}
        />
        <NumberField
          label="Book up to how many days ahead"
          value={rules.maxDaysAhead}
          step={1}
          error={issueAt("maxDaysAhead")}
          onChange={(v) => setNumber("maxDaysAhead", v)}
        />
        <NumberField
          label="Cancel or reschedule up to (h before)"
          value={rules.cancelNoticeMinutes / 60}
          step={1}
          error={issueAt("cancelNoticeMinutes")}
          onChange={(v) => setNumber("cancelNoticeMinutes", Math.round(v * 60))}
        />
      </div>

      <div className="flex items-center gap-3 max-md:flex-wrap">
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save rules"}
        </Button>
        {status === "saved" && <Muted tone="ok">Rules saved.</Muted>}
        {status === "error" && <Muted tone="destructive">Check the highlighted fields.</Muted>}
      </div>
    </Card>
  );
}

function NumberField(props: { label: string; value: number; step: number; error?: string; onChange: (v: number) => void }) {
  return (
    <Field className="my-3">
      {props.label}
      <Input
        type="number"
        min={0}
        step={props.step}
        value={Number.isFinite(props.value) ? props.value : ""}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
        aria-invalid={!!props.error}
      />
      {props.error && <Muted tone="destructive">{props.error}</Muted>}
    </Field>
  );
}
