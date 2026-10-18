import type { FastifyInstance } from "fastify";
import type { EventBus } from "../modules/inbox/events.js";

const HEARTBEAT_MS = 25_000;

/**
 * GET /api/events: Server-Sent Events para o painel. Enquanto houver ao menos um painel aberto,
 * o estado da conexão do WhatsApp é consultado periodicamente (`onFirst` / `onLast`).
 */
export function panelEventsRoutes({
  bus,
  onFirst = () => {},
  onLast = () => {},
  heartbeatMs = HEARTBEAT_MS,
}: {
  bus: EventBus;
  onFirst?: () => void;
  onLast?: () => void;
  heartbeatMs?: number;
}) {
  return async function (app: FastifyInstance) {
    app.get("/api/events", (req, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(": connected\n\n");

      const wasEmpty = bus.subscriberCount() === 0;
      const unsubscribe = bus.subscribe((event) => {
        const { type, ...data } = event;
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      });
      if (wasEmpty) onFirst();

      const heartbeat = setInterval(() => res.write(": ping\n\n"), heartbeatMs);
      req.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        if (bus.subscriberCount() === 0) onLast();
      });
    });
  };
}
