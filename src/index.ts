import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { sql } from "./db/client.js";
import { buildConnectUrl, exchangeCode, revoke } from "./modules/google/oauth.js";
import { bus } from "./modules/inbox/events.js";
import { sendWhatsAppText } from "./modules/whatsapp/evolution.js";
import { instance } from "./modules/whatsapp/instance.js";
import { connectionStore, googleCalendar, listCalendarsFor, rulesStore } from "./routes/calendar.js";
import { evolutionWebhookRoutes } from "./routes/evolution-webhook.js";
import { googleOAuthRoutes } from "./routes/google-oauth.js";
import { healthRoutes } from "./routes/health.js";
import { inbox, inboxRepo } from "./routes/inbox.js";
import { panelApiRoutes } from "./routes/panel-api.js";
import { panelCalendarRoutes } from "./routes/panel-calendar.js";
import { panelEventsRoutes } from "./routes/panel-events.js";
import { registerPanelAuth } from "./routes/panel-session.js";
import { panelStaticRoutes } from "./routes/panel-static.js";

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
    // O cookie de sessão nunca vai para o log
    redact: ["req.headers.cookie", 'res.headers["set-cookie"]'],
  },
});

await app.register(cookie);
registerPanelAuth(app, { password: env.OPERATOR_PASSWORD, publicUrl: env.PUBLIC_URL });
if (!env.OPERATOR_PASSWORD) app.log.warn("painel desativado: defina OPERATOR_PASSWORD");

await app.register(healthRoutes);
await app.register(
  googleOAuthRoutes({
    connection: connectionStore,
    panelUrl: env.PANEL_URL ?? env.PUBLIC_URL,
    exchangeCode,
    listCalendars: listCalendarsFor,
  }),
);
await app.register(evolutionWebhookRoutes);
await app.register(panelApiRoutes({ inbox, repo: inboxRepo, instance, send: sendWhatsAppText }));
await app.register(
  panelCalendarRoutes({ connection: connectionStore, calendar: googleCalendar, rules: rulesStore, buildConnectUrl, revoke }),
);
await app.register(
  panelEventsRoutes({
    bus,
    onFirst: () => instance.startPolling((err) => app.log.warn({ err }, "falha ao consultar a conexão")),
    onLast: () => instance.stopPolling(),
  }),
);
await app.register(panelStaticRoutes);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    instance.stopPolling();
    await app.close();
    await sql.end();
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: "0.0.0.0" });

// Estado inicial da conexão; a Evolution API fora do ar não impede o servidor de subir
instance.refresh().catch((err) => app.log.warn({ err: (err as Error).message }, "estado da conexão indisponível"));
