import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const SERVER_PREFIXES = ["/api", "/auth", "/webhooks", "/health"];

/** Em produção (depois de `npm run build`), entrega o painel e responde index.html nas rotas dele. */
export async function panelStaticRoutes(app: FastifyInstance) {
  if (!existsSync(`${WEB_DIST}index.html`)) {
    app.log.info("painel não compilado (web/dist); em desenvolvimento use npm run dev:web");
    return;
  }
  await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0];
    if (req.method === "GET" && !SERVER_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found" });
  });
}
