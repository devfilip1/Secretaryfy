import { EventEmitter } from "node:events";
import type { CalendarConnectionJson } from "../google/connection.js";
import type { ConversationJson, MessageJson } from "./presenters.js";

export interface ConnectionJson {
  state: "open" | "connecting" | "close";
  number: string | null;
  qr: string | null;
}

/** Eventos enviados ao painel por SSE (GET /api/events). */
export type InboxEvent =
  | { type: "message.created"; conversationId: string; message: MessageJson }
  | { type: "message.updated"; conversationId: string; message: MessageJson }
  | { type: "conversation.updated"; conversation: ConversationJson }
  | ({ type: "connection.updated" } & ConnectionJson)
  | { type: "calendar.updated"; connection: CalendarConnectionJson };

export type Publish = (event: InboxEvent) => void;

export function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  return {
    publish(event: InboxEvent) {
      emitter.emit("event", event);
    },
    /** Devolve a função que cancela a assinatura. */
    subscribe(listener: (event: InboxEvent) => void): () => void {
      emitter.on("event", listener);
      return () => emitter.off("event", listener);
    },
    subscriberCount(): number {
      return emitter.listenerCount("event");
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;

/** Barramento do processo, compartilhado pelo webhook, pela API e pelo SSE. */
export const bus = createEventBus();
