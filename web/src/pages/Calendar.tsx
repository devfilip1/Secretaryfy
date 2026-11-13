import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useConfirm } from "../components/ConfirmDialog";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";
import { useInboxEvents } from "../useEvents";
import { issueParamsForPanel } from "./calendar-rules-issue";

const DAYS: { key: DayKey; label: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday" }[] = [
  { key: "1", label: "monday" },
  { key: "2", label: "tuesday" },
  { key: "3", label: "wednesday" },
  { key: "4", label: "thursday" },
  { key: "5", label: "friday" },
  { key: "6", label: "saturday" },
  { key: "7", label: "sunday" },
];

/** Avisos da volta do Google (?google=... no hash, contracts/panel-api.md). O valor é o tom: true = ok. O texto vem de notices.<desfecho>. */
const OAUTH_NOTICES = { connected: true, denied: false, error: false, missing_scope: false } as const;
type OAuthOutcome = keyof typeof OAUTH_NOTICES;

/** Erros desta tela: a chave vai para errors.<chave> em calendar.json. */
type ErrorKey = "load" | "connect" | "googleNotConfigured" | "disconnect" | "changeCalendar";

/** Lê e limpa o ?google= do hash. */
function takeOAuthNotice(): OAuthOutcome | null {
  const [path, query] = window.location.hash.split("?");
  const outcome = new URLSearchParams(query).get("google");
  if (outcome) history.replaceState(null, "", path);
  return outcome && outcome in OAUTH_NOTICES ? (outcome as OAuthOutcome) : null;
}

export function CalendarPage() {
  const { t } = useTranslation("calendar");
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [rules, setRules] = useState<CalendarRules | null>(null);
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null);
  const [notice, setNotice] = useState(takeOAuthNotice);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    getCalendar()
      .then((s) => {
        setConnection(s.connection);
        setRules((current) => current ?? s.rules);
      })
      .catch(() => setError("load"));
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
      setError(err instanceof ApiError && err.error === "google_not_configured" ? "googleNotConfigured" : "connect");
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: t("disconnectTitle"),
      description: t("disconnectConfirm"),
      confirmLabel: t("disconnect"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await disconnectCalendar();
      load();
    } catch {
      setError("disconnect");
    } finally {
      setBusy(false);
    }
  }

  async function choose(calendarId: string) {
    try {
      setConnection((await selectCalendar(calendarId)).connection);
    } catch {
      setError("changeCalendar");
    }
  }

  if (!connection || !rules) return <Page className="text-muted-foreground">{error ? t(`errors.${error}`) : t("loading")}</Page>;

  return (
    <Page>
      {dialog}
      <div className="grid w-[min(720px,100%)] gap-4 max-md:gap-3">
        {notice && (
          <Notice
            layout="box"
            tone={OAUTH_NOTICES[notice] ? "ok" : "destructive"}
            role="status"
            onDismiss={() => setNotice(null)}
          >
            {t(`notices.${notice}`)}
          </Notice>
        )}
        {error && <Notice role="alert">{t(`errors.${error}`)}</Notice>}

        <Card as="section" className="w-full">
          <Title level={2} className="mb-3">
            {t("title")}
          </Title>
          {connection.status === "disconnected" ? (
            <>
              <p className="my-4 text-muted-foreground">{t("connectIntro")}</p>
              <Button onClick={connect} disabled={busy}>
                {t("connect")}
              </Button>
            </>
          ) : (
            <>
              {connection.status === "needs_reauth" && (
                <Notice layout="box" tone="destructive" className="mb-3">
                  {t("reauthNotice")}
                  <Button onClick={connect} disabled={busy}>
                    {t("reconnect")}
                  </Button>
                </Notice>
              )}
              <p className="my-4">
                {t("account")} <strong>{connection.email}</strong>
                <br />
                <Muted>
                  {t("timeZone")} <strong>{connection.timeZone}</strong>
                </Muted>
              </p>
              {/^(UTC|Etc\/)/.test(connection.timeZone) && (
                <Notice layout="box" tone="destructive" className="mb-3">
                  {t("timeZoneWarning", { timeZone: connection.timeZone })}
                </Notice>
              )}
              <Field className="my-3">
                {t("calendarLabel")}
                <Select value={connection.calendarId} onValueChange={choose} disabled={!calendars || calendars.length === 0}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(calendars ?? [{ id: connection.calendarId, name: connection.calendarName, timeZone: "", primary: false }]).map(
                      (c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.primary ? t("calendarPrimary", { name: c.name }) : c.name}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={disconnect} disabled={busy}>
                {t("disconnect")}
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
  const { t } = useTranslation("calendar");
  const [rules, setRules] = useState(initial);
  const [issues, setIssues] = useState<RulesIssue[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  /** Traduz pelo código; um código sem tradução mostra o texto em inglês do servidor. */
  const issueText = (issue: RulesIssue) => t(`rules.issue.${issue.code}` as never, { ...issueParamsForPanel(issue), defaultValue: issue.message });
  const issueAt = (path: string) => {
    const issue = issues.find((i) => i.path === path || i.path.startsWith(`${path}.`));
    return issue && issueText(issue);
  };

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
        {t("rules.title")}
      </Title>
      <Muted as="p" className="my-4">
        {t("rules.intro")}
      </Muted>

      <div className="my-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
        {DAYS.map(({ key, label }) => {
          const hours = rules.weeklyHours[key];
          const problem = issueAt(`weeklyHours.${key}`);
          const day = t(`days.${label}`);
          return (
            <div
              key={key}
              className="grid min-h-10 grid-cols-[130px_auto_auto_auto_1fr] items-center gap-2 px-3 py-1.5 max-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-md:gap-x-2 max-md:gap-y-1"
            >
              <label className="flex items-center gap-2 max-md:col-span-full">
                <input type="checkbox" checked={!!hours} onChange={(e) => setDay(key, e.target.checked ? {} : null)} />
                {day}
              </label>
              {hours ? (
                <>
                  <Input
                    type="time"
                    aria-label={t("rules.startOf", { day })}
                    className="tnum w-auto max-md:w-full max-md:px-2"
                    value={hours.start}
                    onChange={(e) => setDay(key, { start: e.target.value })}
                  />
                  <span className="text-muted-foreground max-md:hidden">{t("rules.to")}</span>
                  <Input
                    type="time"
                    aria-label={t("rules.endOf", { day })}
                    className="tnum w-auto max-md:w-full max-md:px-2"
                    value={hours.end}
                    onChange={(e) => setDay(key, { end: e.target.value })}
                  />
                </>
              ) : (
                <Muted className="max-md:col-span-full">{t("rules.closed")}</Muted>
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
          label={t("rules.slotMinutes")}
          value={rules.slotMinutes}
          step={5}
          error={issueAt("slotMinutes")}
          onChange={(v) => setNumber("slotMinutes", v)}
        />
        <NumberField
          label={t("rules.gridMinutes")}
          value={rules.gridMinutes}
          step={5}
          error={issueAt("gridMinutes")}
          onChange={(v) => setNumber("gridMinutes", v)}
        />
        <NumberField
          label={t("rules.minNoticeHours")}
          value={rules.minNoticeMinutes / 60}
          step={0.5}
          error={issueAt("minNoticeMinutes")}
          onChange={(v) => setNumber("minNoticeMinutes", Math.round(v * 60))}
        />
        <NumberField
          label={t("rules.maxDaysAhead")}
          value={rules.maxDaysAhead}
          step={1}
          error={issueAt("maxDaysAhead")}
          onChange={(v) => setNumber("maxDaysAhead", v)}
        />
        <NumberField
          label={t("rules.cancelNoticeHours")}
          value={rules.cancelNoticeMinutes / 60}
          step={1}
          error={issueAt("cancelNoticeMinutes")}
          onChange={(v) => setNumber("cancelNoticeMinutes", Math.round(v * 60))}
        />
      </div>

      <div className="flex items-center gap-3 max-md:flex-wrap">
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? t("rules.saving") : t("rules.save")}
        </Button>
        {status === "saved" && <Muted tone="ok">{t("rules.saved")}</Muted>}
        {status === "error" && <Muted tone="destructive">{t("rules.checkFields")}</Muted>}
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
