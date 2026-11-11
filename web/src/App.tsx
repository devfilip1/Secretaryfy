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
import { PanelLanguage } from "./i18n/PanelLanguage";
import { usePanelLanguage } from "./i18n/usePanelLanguage";
import { BookOpen, Calendar, CalendarCheck, MessageSquare, Smartphone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventsContext, useEventStream, useInboxEvents } from "./useEvents";

type Session = "loading" | "login" | "disabled" | "ready";
type View = "inbox" | "appointments" | "connection" | "calendar" | "customers" | "knowledge";

/** Os seis destinos: a barra de baixo (celular) e os links de cima (md para cima) saem desta lista. */
/** `labelKey` e `shortKey` são chaves do common.json; `shortKey` é o rótulo da barra de baixo, que tem uma célula de 1/6 da largura. */
const NAV_LINKS = [
  { labelKey: "nav.conversations", shortKey: "nav.short.chats", hash: "#/", view: "inbox", icon: MessageSquare },
  { labelKey: "nav.appointments", shortKey: "nav.short.appointments", hash: "#/appointments", view: "appointments", icon: CalendarCheck },
  { labelKey: "nav.connection", shortKey: "nav.short.whatsapp", hash: "#/connection", view: "connection", icon: Smartphone },
  { labelKey: "nav.calendar", shortKey: "nav.short.calendar", hash: "#/calendar", view: "calendar", icon: Calendar },
  { labelKey: "nav.customers", shortKey: "nav.short.customers", hash: "#/customers", view: "customers", icon: Users },
  { labelKey: "nav.knowledge", shortKey: "nav.short.knowledge", hash: "#/knowledge", view: "knowledge", icon: BookOpen },
] as const;

function viewFromHash(): View {
  const path = window.location.hash.split("?")[0];
  if (path === "#/appointments") return "appointments";
  if (path === "#/connection" || path === "#/conexao") return "connection";
  if (path === "#/calendar" || path === "#/agenda") return "calendar";
  if (path === "#/customers" || path === "#/clientes") return "customers";
  if (path === "#/knowledge") return "knowledge";
  return "inbox";
}

/** Link da navegação: no celular é uma célula da barra de baixo (ícone sobre o texto); de md para cima, um link da barra de cima. */
function navLinkClass(active: boolean): string {
  const state = active ? "border-primary text-primary md:text-foreground" : "border-transparent text-muted-foreground";
  return `${state} flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 border-t-2 text-[11px] leading-tight no-underline md:min-h-0 md:flex-row md:border-t-0 md:border-b-2 md:px-0.5 md:py-1 md:text-sm`;
}

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

/** Painel logado: barra superior com a conexão, navegação e tempo real. */
function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { t } = useTranslation();
  const { status, subscribe } = useEventStream(onLoggedOut);
  const [view, setView] = useState<View>(viewFromHash);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [protection, setProtection] = useState<Protection | null>(null);

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
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
      <div className="flex h-full flex-col max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-4.5 px-4 py-2.5 md:px-6 max-lg:flex-wrap max-lg:gap-x-3 max-lg:gap-y-1.5 md:max-lg:pt-2 md:max-lg:pb-0">
            <span className="font-bold max-lg:flex-1">Secretaryfy</span>
            <nav className="max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:grid max-md:grid-cols-6 max-md:border-t max-md:border-border max-md:bg-card max-md:pb-[env(safe-area-inset-bottom)] md:flex md:flex-1 md:gap-3.5 md:max-lg:order-3 md:max-lg:min-w-0 md:max-lg:basis-full md:max-lg:justify-between md:max-lg:gap-0.5">
              {NAV_LINKS.map(({ labelKey, shortKey, hash, view: target, icon: Icon }) => (
                <a key={hash} href={hash} className={navLinkClass(view === target)} aria-current={view === target ? "page" : undefined}>
                  <Icon className="size-5 shrink-0 md:hidden" aria-hidden />
                  <span className="max-w-full truncate md:hidden">{t(shortKey)}</span>
                  <span className="max-w-full truncate max-md:hidden">{t(labelKey)}</span>
                </a>
              ))}
            </nav>
            <ConnectionBadge connection={connection} />
            <PanelLanguage />
            <Button variant="link" onClick={leave}>
              {t("signOut")}
            </Button>
          </div>
        </header>
        {status === "reconnecting" && <div className="bg-warn p-1 text-center text-sm text-warn-foreground">{t("reconnecting")}</div>}
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
