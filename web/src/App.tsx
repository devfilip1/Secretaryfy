import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { AppRail } from "./components/app-rail";
import { AppTopBar } from "./components/app-top-bar";
import { CenterPage } from "./components/CenterPage";
import { MobileTabBar } from "./components/mobile-tab-bar";
import { MobileTopBar } from "./components/mobile-top-bar";
import { ProtectionBanner } from "./components/ProtectionBanner";
import { AppointmentsPage } from "./pages/Appointments";
import { CalendarPage } from "./pages/Calendar";
import { ConnectionPage } from "./pages/Connection";
import { CustomersPage } from "./pages/Customers";
import { KnowledgePage } from "./pages/Knowledge";
import { Disabled } from "./pages/Disabled";
import { Inbox } from "./pages/Inbox";
import { Login } from "./pages/Login";
import { usePanelLanguage } from "./i18n/usePanelLanguage";
import { viewFromHash, type View } from "./nav";
import { useAttentionCount } from "./useAttentionCount";
import { EventsContext, useEventStream, useInboxEvents } from "./useEvents";

type Session = "loading" | "login" | "disabled" | "ready";

export function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session>("loading");
  usePanelLanguage(session === "ready");

  const check = useCallback(() => {
    getSession()
      .then(() => setSession("ready"))
      .catch((err) => setSession(err instanceof ApiError && err.status === 503 ? "disabled" : "login"));
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => setSession("login"));
    check();
  }, [check]);

  if (session === "loading") return <CenterPage className="text-muted-foreground">{t("loading")}</CenterPage>;
  if (session === "disabled") return <Disabled />;
  if (session === "login") return <Login onLoggedIn={() => setSession("ready")} />;
  return <Shell onLoggedOut={() => setSession("login")} />;
}

/** Painel logado: barra lateral (md para cima) ou barra de cima e de baixo (celular), com a conexão e o tempo real. */
function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { t } = useTranslation();
  const { status, subscribe } = useEventStream(onLoggedOut);
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash));
  const [connection, setConnection] = useState<Connection | null>(null);
  const [protection, setProtection] = useState<Protection | null>(null);

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash(window.location.hash));
    };
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
      <div className="flex h-full">
        <AttentionRail view={view} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
          <MobileTopBar connection={connection} onSignOut={leave} />
          <AppTopBar view={view} connection={connection} onSignOut={leave} />
          {status === "reconnecting" && <div className="bg-warn p-1 text-center text-sm text-warn-foreground">{t("reconnecting")}</div>}
          <ProtectionBanner protection={protection} />
          {view === "inbox" && <Inbox connected={connection?.state === "open"} />}
          {view === "appointments" && <AppointmentsPage />}
          {view === "connection" && <ConnectionPage connection={connection} onChange={setConnection} />}
          {view === "calendar" && <CalendarPage />}
          {view === "customers" && <CustomersPage />}
          {view === "knowledge" && <KnowledgePage />}
        </div>
        <MobileTabBar view={view} />
      </div>
    </EventsContext.Provider>
  );
}

/** A barra lateral com a contagem de conversas que pedem atenção. Fica dentro do EventsContext, onde o hook assina o SSE. */
function AttentionRail({ view }: { view: View }) {
  const attentionCount = useAttentionCount();
  return <AppRail view={view} attentionCount={attentionCount} />;
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
