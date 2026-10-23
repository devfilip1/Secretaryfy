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
  { key: "1", label: "Segunda" },
  { key: "2", label: "Terça" },
  { key: "3", label: "Quarta" },
  { key: "4", label: "Quinta" },
  { key: "5", label: "Sexta" },
  { key: "6", label: "Sábado" },
  { key: "7", label: "Domingo" },
];

/** Avisos da volta do Google (?google=... no hash, contracts/panel-api.md). */
const OAUTH_NOTICES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Agenda conectada.", ok: true },
  denied: { text: "A autorização foi cancelada na tela do Google. Nada mudou.", ok: false },
  error: { text: "Não foi possível conectar a agenda. Tente de novo.", ok: false },
  missing_scope: {
    text: "Faltou autorizar o acesso à agenda. Conecte de novo e deixe todas as permissões marcadas.",
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
      .catch(() => setError("Não foi possível carregar a agenda."));
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
          ? "As credenciais do Google não estão configuradas no servidor. Preencha GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env com as do Google Cloud Console e reinicie o servidor."
          : "Não foi possível iniciar a conexão com o Google.",
      );
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Desconectar a agenda? O assistente deixa de oferecer e marcar horários até você conectar de novo.")) return;
    setBusy(true);
    try {
      await disconnectCalendar();
      load();
    } catch {
      setError("Não foi possível desconectar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function choose(calendarId: string) {
    try {
      setConnection((await selectCalendar(calendarId)).connection);
    } catch {
      setError("Não foi possível trocar a agenda.");
    }
  }

  if (!connection || !rules) return <main className="page muted">{error ?? "Carregando…"}</main>;

  return (
    <main className="page">
      <div className="calendar-page">
        {notice && (
          <div className={`flash ${notice.ok ? "ok" : "bad"}`} role="status">
            {notice.text}
            <button className="link" onClick={() => setNotice(null)} aria-label="Fechar aviso">
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
          <h2>Google Agenda</h2>
          {connection.status === "disconnected" ? (
            <>
              <p className="muted">
                Conecte a agenda da clínica para o assistente consultar os horários livres e marcar avaliações pelo
                WhatsApp.
              </p>
              <button className="primary" onClick={connect} disabled={busy}>
                Conectar Google Agenda
              </button>
            </>
          ) : (
            <>
              {connection.status === "needs_reauth" && (
                <div className="flash bad">
                  O Google recusou o acesso à agenda. Reconecte para o assistente voltar a agendar.
                  <button className="primary" onClick={connect} disabled={busy}>
                    Reconectar
                  </button>
                </div>
              )}
              <p>
                Conta: <strong>{connection.email}</strong>
                <br />
                <span className="muted small">
                  Fuso dos horários: <strong>{connection.timeZone}</strong>
                </span>
              </p>
              {/^(UTC|Etc\/)/.test(connection.timeZone) && (
                <div className="flash bad">
                  A agenda está em {connection.timeZone}: os horários oferecidos aos clientes serão calculados nesse fuso.
                  Ajuste o fuso da agenda nas configurações do Google Agenda e recarregue esta página.
                </div>
              )}
              <label className="field">
                Agenda usada para os agendamentos
                <select
                  value={connection.calendarId}
                  onChange={(e) => choose(e.target.value)}
                  disabled={!calendars || calendars.length === 0}
                >
                  {(calendars ?? [{ id: connection.calendarId, name: connection.calendarName, timeZone: "", primary: false }]).map(
                    (c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.primary ? " (principal)" : ""}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button className="danger" onClick={disconnect} disabled={busy}>
                Desconectar
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
      <h2>Regras de atendimento</h2>
      <p className="muted small">O assistente só oferece horários dentro destas regras e livres na agenda.</p>

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
                    aria-label={`${label}: início`}
                    value={hours.start}
                    onChange={(e) => setDay(key, { start: e.target.value })}
                  />
                  <span className="muted">às</span>
                  <input
                    type="time"
                    aria-label={`${label}: fim`}
                    value={hours.end}
                    onChange={(e) => setDay(key, { end: e.target.value })}
                  />
                </>
              ) : (
                <span className="muted small">Sem atendimento</span>
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
        <NumberField label="Duração da consulta (min)" value={rules.slotMinutes} step={5} error={issueAt("slotMinutes")}
          onChange={(v) => setNumber("slotMinutes", v)} />
        <NumberField label="Antecedência mínima para marcar (h)" value={rules.minNoticeMinutes / 60} step={0.5}
          error={issueAt("minNoticeMinutes")} onChange={(v) => setNumber("minNoticeMinutes", Math.round(v * 60))} />
        <NumberField label="Marcar até quantos dias à frente" value={rules.maxDaysAhead} step={1}
          error={issueAt("maxDaysAhead")} onChange={(v) => setNumber("maxDaysAhead", v)} />
        <NumberField label="Cancelar ou remarcar até (h antes)" value={rules.cancelNoticeMinutes / 60} step={1}
          error={issueAt("cancelNoticeMinutes")} onChange={(v) => setNumber("cancelNoticeMinutes", Math.round(v * 60))} />
      </div>

      <div className="form-actions">
        <button className="primary" type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Salvando…" : "Salvar regras"}
        </button>
        {status === "saved" && <span className="ok-text small">Regras salvas.</span>}
        {status === "error" && <span className="error small">Revise os campos destacados.</span>}
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
