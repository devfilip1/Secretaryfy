import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CalendarConnection, Connection, Conversation, Message, Protection } from "./api";
import { ApiError, getSession } from "./api";

export type InboxEvent =
  | { type: "message.created" | "message.updated"; conversationId: string; message: Message }
  | { type: "conversation.updated"; conversation: Conversation }
  /** O WhatsApp foi desconectado e todas as conversas foram apagadas. */
  | { type: "conversations.cleared" }
  /** O cadastro de clientes mudou: a aba Clientes busca a lista de novo. */
  | { type: "customers.updated" }
  /** Os horários mudaram: a aba Appointments busca a lista de novo. */
  | { type: "appointments.updated" }
  | ({ type: "connection.updated" } & Connection)
  | { type: "calendar.updated"; connection: CalendarConnection }
  | ({ type: "protection.updated" } & Protection)
  /** Emitido pelo próprio painel quando o SSE volta depois de cair: hora de buscar tudo de novo. */
  | { type: "reconnected" };

type Listener = (event: InboxEvent) => void;
export type StreamStatus = "connecting" | "open" | "reconnecting";

const SERVER_EVENTS = [
  "message.created",
  "message.updated",
  "conversation.updated",
  "conversations.cleared",
  "customers.updated",
  "appointments.updated",
  "connection.updated",
  "calendar.updated",
  "protection.updated",
] as const;
const RETRY_MS = 3000;

/** Abre o SSE (/api/events), reconecta quando cai e repassa os eventos aos assinantes. */
export function useEventStream(onUnauthenticated: () => void) {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const listeners = useRef(new Set<Listener>());
  const unauth = useRef(onUnauthenticated);
  unauth.current = onUnauthenticated;

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let dropped = false;
    let closed = false;
    const emit = (event: InboxEvent) => listeners.current.forEach((l) => l(event));

    function open() {
      source = new EventSource("/api/events");
      source.onopen = () => {
        setStatus("open");
        if (dropped) emit({ type: "reconnected" });
        dropped = false;
      };
      source.onerror = () => {
        dropped = true;
        setStatus("reconnecting");
        // O navegador desiste sozinho quando a resposta não é 200 (ex.: sessão expirada)
        if (source?.readyState === EventSource.CLOSED && !closed) {
          getSession()
            .then(() => {
              retry = setTimeout(open, RETRY_MS);
            })
            .catch((err) => {
              if (err instanceof ApiError && err.status === 401) unauth.current();
              else retry = setTimeout(open, RETRY_MS);
            });
        }
      };
      for (const type of SERVER_EVENTS) {
        source.addEventListener(type, (e) => emit({ type, ...JSON.parse((e as MessageEvent).data) }));
      }
    }

    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      source?.close();
    };
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { status, subscribe };
}

export const EventsContext = createContext<{ subscribe: (l: Listener) => () => void }>({
  subscribe: () => () => {},
});

/** Assina os eventos do painel enquanto o componente estiver montado. */
export function useInboxEvents(handler: Listener) {
  const { subscribe } = useContext(EventsContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}
