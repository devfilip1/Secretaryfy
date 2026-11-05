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
import { CenterPage } from "./components/CenterPage";
import { ProtectionBanner } from "./components/ProtectionBanner";
import { AppointmentsPage } from "./pages/Appointments";
import { CalendarPage } from "./pages/Calendar";
import { ConnectionPage } from "./pages/Connection";
import { CustomersPage } from "./pages/Customers";
import { KnowledgePage } from "./pages/Knowledge";
import { Disabled } from "./pages/Disabled";
import { Inbox } from "./pages/Inbox";
import { Login } from "./pages/Login";
import { Button } from "@/components/ui/button";
import { EventsContext, useEventStream, useInboxEvents } from "./useEvents";

type Session = "loading" | "login" | "disabled" | "ready";
type View = "inbox" | "appointments" | "connection" | "calendar" | "customers" | "knowledge";

function viewFromHash(): View {
  const path = window.location.hash.split("?")[0];
  if (path === "#/appointments") return "appointments";
  if (path === "#/connection" || path === "#/conexao") return "connection";
  if (path === "#/calendar" || path === "#/agenda") return "calendar";
  if (path === "#/customers" || path === "#/clientes") return "customers";
  if (path === "#/knowledge") return "knowledge";
  return "inbox";
}

/** Link da navegação: a aba ativa ganha a linha de destaque e a cor do texto. */
function navLinkClass(active: boolean): string {
  const state = active ? "border-primary text-foreground" : "border-transparent text-muted-foreground";
  return `${state} border-b-2 px-0.5 py-1 no-underline max-md:shrink-0 max-md:px-0.5 max-md:py-2 max-md:text-sm`;
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

  if (session === "loading") return <CenterPage className="text-muted-foreground">Loading…</CenterPage>;
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
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-4.5 border-b border-border bg-card px-4 py-2.5 max-lg:flex-wrap max-lg:gap-x-3 max-lg:gap-y-1.5 max-lg:pt-2 max-lg:pb-0">
          <span className="font-bold max-lg:flex-1">Secretaryfy</span>
          <nav className="flex flex-1 gap-3.5 max-lg:order-3 max-lg:min-w-0 max-lg:basis-full max-lg:justify-between max-lg:gap-0.5 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden">
            <a href="#/" className={navLinkClass(view === "inbox")}>
              Conversations
            </a>
            <a href="#/appointments" className={navLinkClass(view === "appointments")}>
              Appointments
            </a>
            <a href="#/connection" className={navLinkClass(view === "connection")}>
              Connection
            </a>
            <a href="#/calendar" className={navLinkClass(view === "calendar")}>
              Calendar
            </a>
            <a href="#/customers" className={navLinkClass(view === "customers")}>
              Customers
            </a>
            <a href="#/knowledge" className={navLinkClass(view === "knowledge")}>
              Knowledge
            </a>
          </nav>
          <ConnectionBadge connection={connection} />
          <Button variant="link" onClick={leave}>
            Sign out
          </Button>
        </header>
        {status === "reconnecting" && <div className="bg-warn p-1 text-center text-sm text-warn-foreground">Reconnecting to the server…</div>}
        <ProtectionBanner protection={protection} />
        {view === "inbox" && <Inbox connected={connection?.state === "open"} />}
        {view === "appointments" && <AppointmentsPage />}
        {view === "connection" && <ConnectionPage connection={connection} onChange={setConnection} />}
        {view === "calendar" && <CalendarPage />}
        {view === "customers" && <CustomersPage />}
        {view === "knowledge" && <KnowledgePage />}
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
