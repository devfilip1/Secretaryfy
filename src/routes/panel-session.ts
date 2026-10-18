import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createLoginLimiter, type LoginLimiter } from "../modules/auth/login-limiter.js";
import { checkPassword, cookieOptions, createSessionToken, SESSION_COOKIE, verifySessionToken } from "../modules/auth/session.js";

const loginBody = z.object({ password: z.string() });
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * Login do painel e proteção de todo /api/*. Registrado direto no app (não como plugin encapsulado),
 * para o hook valer em todas as rotas da API.
 */
export function registerPanelAuth(
  app: FastifyInstance,
  { password, publicUrl, limiter = createLoginLimiter() }: { password: string | undefined; publicUrl: string; limiter?: LoginLimiter },
) {
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/")) return;
    if (!password) return reply.code(503).send({ error: "panel_disabled" });

    if (BODY_METHODS.has(req.method) && !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
      return reply.code(415).send({ error: "unsupported_media_type" });
    }
    if (path === "/api/session") return;
    if (!verifySessionToken(req.cookies[SESSION_COOKIE])) return reply.code(401).send({ error: "unauthenticated" });
  });

  app.post("/api/session", async (req, reply) => {
    const ip = req.ip;
    const gate = limiter.check(ip);
    if (!gate.allowed) return reply.code(429).send({ error: "too_many_attempts", retry_after_s: gate.retryAfterS });

    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success || !checkPassword(parsed.data.password, password!)) {
      limiter.fail(ip);
      req.log.warn({ ip }, "login do painel recusado");
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    limiter.succeed(ip);
    reply.setCookie(SESSION_COOKIE, createSessionToken(), cookieOptions(publicUrl));
    return reply.code(204).send();
  });

  app.get("/api/session", async (req, reply) => {
    if (!verifySessionToken(req.cookies[SESSION_COOKIE])) return reply.code(401).send({ error: "unauthenticated" });
    return { authenticated: true };
  });

  app.delete("/api/session", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });
}
