import type { FastifyInstance } from "fastify";
import type { Gate } from "../modules/antiban/gate.js";

/** Estado da proteção do número para o painel (specs/004-whatsapp-anti-ban/contracts/panel-api.md). */
export function panelProtectionRoutes({ gate }: { gate: Pick<Gate, "protectionStatus"> }) {
  return async function (app: FastifyInstance) {
    app.get("/api/protection", async () => gate.protectionStatus());
  };
}
