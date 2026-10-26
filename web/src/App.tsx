import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getConnection,
  getProtection,
  getSession,
  logout,
  setUnauthenticatedHandler,
  type Connection,
  type Protection,
} from "./api";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { ProtectionBanner } from "./components/ProtectionBanner";
import { AppointmentsPage } from "./pages/Appointments";
import { CalendarPage } from "./pages/Calendar";
import { ConnectionPage } from "./pages/Connection";
import { CustomersPage } from "./pages/Customers";
import { Disabled } from "./pages/Disabled";
import { Inbox } from "./pages/Inbox";
import { Login } from "./pages/Login";
import { EventsContext, useEventStream, useInboxEvents } from "./useEvents";

type Session = "loading" | "login" | "disabled" | "ready";
type View = "inbox" | "appointments" | "connection" | "calendar" | "customers";

function viewFromHash(): View {
  const path = window.location.hash.split("?")[0];
  if (path === "#/appointments") return "appointments";
  if (path === "#/connection" || path === "#/conexao") return "connection";
  if (path === "#/calendar" || path === "#/agenda") return "calendar";
  if (path === "#/customers" || path === "#/clientes") return "customers";
  return "inbox";
}

export function App() {
  const [session, setSession] = useState<Session>("loading");

  const check = useCallback(() => {
    getSession()
      .then(() => setSession("ready"))
      .catch((err) => setSession(err instanceof ApiError && err.status === 503 ? "disabled" : "login"));
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => setSession("login"));
    check();
  }, [check]);

  if (session === "loading") return <main className="center-page muted">Loading…</main>;
  if (session === "disabled") return <Disabled />;
  if (session === "login") return <Login onLoggedIn={() => setSession("ready")} />;
  return <Shell onLoggedOut={() => setSession("login")} />;
}

/** Painel logado: barra superior com a conexão, navegação e tempo real. */
function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { status, subscribe } = useEventStream(onLoggedOut);
  const [view, setView] = useState<View>(viewFromHash);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [protection, setProtection] = useState<Protection | null>(null);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadConnection = useCallback(() => {
    getConnection()
      .then(setConnection)
      .catch(() => {});
  }, []);
  useEffect(loadConnection, [loadConnection]);

  const loadProtection = useCallback(() => {
    getProtection()
      .then(setProtection)
      .catch(() => {});
  }, []);
  useEffect(loadProtection, [loadProtection]);

  async function leave() {
    await logout().catch(() => {});
    onLoggedOut();
  }

  return (
    <EventsContext.Provider value={{ subscribe }}>
      <ConnectionSync
        onChange={setConnection}
        onProtection={setProtection}
        onReconnect={() => {
          loadConnection();
          loadProtection();
        }}
      />
      <div className="shell">
        <header className="topbar">
          <span className="brand">Secretaryfy</span>
          <nav>
            <a href="#/" className={view === "inbox" ? "active" : ""}>
              Conversations
            </a>
            <a href="#/appointments" className={view === "appointments" ? "active" : ""}>
              Appointments
            </a>
            <a href="#/connection" className={view === "connection" ? "active" : ""}>
              Connection
            </a>
            <a href="#/calendar" className={view === "calendar" ? "active" : ""}>
              Calendar
            </a>
            <a href="#/customers" className={view === "customers" ? "active" : ""}>
              Customers
            </a>
          </nav>
          <ConnectionBadge connection={connection} />
          <button className="link" onClick={leave}>
            Sign out
          </button>
        </header>
        {status === "reconnecting" && <div className="banner">Reconnecting to the server…</div>}
        <ProtectionBanner protection={protection} />
        {view === "inbox" && <Inbox connected={connection?.state === "open"} />}
        {view === "appointments" && <AppointmentsPage />}
        {view === "connection" && <ConnectionPage connection={connection} onChange={setConnection} />}
        {view === "calendar" && <CalendarPage />}
        {view === "customers" && <CustomersPage />}
      </div>
    </EventsContext.Provider>
  );
}

/** Mantém o estado da conexão do WhatsApp e o da proteção do número em dia com o SSE. */
function ConnectionSync({
  onChange,
  onProtection,
  onReconnect,
}: {
  onChange: (c: Connection) => void;
  onProtection: (p: Protection) => void;
  onReconnect: () => void;
}) {
  useInboxEvents((event) => {
    if (event.type === "connection.updated") onChange({ state: event.state, number: event.number, qr: event.qr });
    if (event.type === "protection.updated") {
      const { type: _type, ...protection } = event;
      onProtection(protection);
    }
    if (event.type === "reconnected") onReconnect();
  });
  return null;
}
