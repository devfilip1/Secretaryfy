import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { sql } from "./db/client.js";
import { bus } from "./modules/inbox/events.js";
import { presentMessage } from "./modules/inbox/presenters.js";
import { createReminderScheduler } from "./modules/reminders/scheduler.js";
import { connectionStore, googleCalendar, googleOAuth, listCalendarsFor, rulesStore, startFakeCalendar } from "./routes/calendar.js";
import { booking, catalog, clinic, clinicSettings, knowledge, schedulingReplies, schedulingStore } from "./routes/scheduling.js";
import { knowledgeInternalRoutes } from "./routes/knowledge-internal.js";
import { clinicInternalRoutes } from "./routes/clinic-internal.js";
import { createRagAdmin } from "./modules/rag/admin.js";
import { panelKnowledgeRoutes } from "./routes/panel-knowledge.js";
import { cancelPendingReply, evolutionWebhookRoutes, rememberNumber } from "./routes/evolution-webhook.js";
import { googleOAuthRoutes } from "./routes/google-oauth.js";
import { healthRoutes } from "./routes/health.js";
import { antibanRepo, customerRepo, gate, inbox, inboxRepo, instance, useProtectionLogger } from "./routes/inbox.js";
import { panelApiRoutes } from "./routes/panel-api.js";
import { panelAppointmentsRoutes } from "./routes/panel-appointments.js";
import { panelCalendarRoutes } from "./routes/panel-calendar.js";
import { panelClinicRoutes } from "./routes/panel-clinic.js";
import { panelCustomersRoutes } from "./routes/panel-customers.js";
import { panelEventsRoutes } from "./routes/panel-events.js";
import { panelProtectionRoutes } from "./routes/panel-protection.js";
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

useProtectionLogger(app.log);

const fakeMode = env.CALENDAR_MODE === "fake";
// Modo fake: sem OAuth. Se o callback do Google chegar mesmo assim, o painel recebe erro em vez de falar com o Google
const exchangeOffline = async (): Promise<never> => {
  throw new Error("CALENDAR_MODE=fake: OAuth do Google desligado");
};

// Respostas do assistente que estavam na fila quando o servidor parou não são reenviadas (specs/004, research.md R2)
for (const message of await antibanRepo.blockOrphanSending()) {
  bus.publish({ type: "message.updated", conversationId: message.conversationId, message: presentMessage(message) });
}

await app.register(cookie);
registerPanelAuth(app, { password: env.OPERATOR_PASSWORD, publicUrl: env.PUBLIC_URL });
if (!env.OPERATOR_PASSWORD) app.log.warn("painel desativado: defina OPERATOR_PASSWORD");
if (!googleOAuth.isConfigured()) {
  app.log.warn("Google Agenda indisponível: GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET não são credenciais reais (docs/development.md, Google Calendar setup)");
}

if (fakeMode) {
  // Sem Google: a conexão do banco passa a ser a falsa, e os agendamentos antigos viram "cancelados no Google"
  const { storedAppointments } = await startFakeCalendar();
  app.log.warn("Agenda falsa em memória: nada é gravado no Google");
  if (storedAppointments > 0) {
    app.log.warn({ storedAppointments }, "agendamentos futuros do banco restaurados na agenda falsa (ela começa vazia a cada início)");
  }
}

// A identidade da clínica vem do banco; na primeira vez, semeia do env (ADR 0012, passo 2)
const storedClinic = await clinicSettings.get();
if (storedClinic) clinic.update(storedClinic);
else await clinicSettings.save(clinic);

// Os tratamentos que se podem marcar vêm da tabela de conhecimento: o retrato em memória começa aqui (ADR 0014)
await catalog.refresh();

await app.register(healthRoutes);
// Fora do login do painel: protegido só pelo INTERNAL_TOKEN (sem ele, a rota não existe)
await app.register(
  knowledgeInternalRoutes({ repo: knowledge, rules: rulesStore, clinic, language: clinic.language, token: env.INTERNAL_TOKEN ?? "" }),
);
await app.register(clinicInternalRoutes({ clinic, knowledge, token: env.INTERNAL_TOKEN ?? "" }));
await app.register(
  googleOAuthRoutes({
    connection: connectionStore,
    panelUrl: env.PANEL_URL ?? env.PUBLIC_URL,
    exchangeCode: fakeMode ? exchangeOffline : googleOAuth.exchangeCode,
    listCalendars: listCalendarsFor,
  }),
);
await app.register(evolutionWebhookRoutes);
await app.register(
  panelApiRoutes({
    inbox,
    repo: inboxRepo,
    instance,
    // Todo envio passa pela proteção do número (specs/004)
    send: (phone, text) => gate.sendOperator(phone, text),
    risks: (conversation) => gate.operatorRisks(conversation),
    onOperatorMessage: cancelPendingReply,
  }),
);
await app.register(panelProtectionRoutes({ gate }));
await app.register(
  panelCustomersRoutes({
    customers: customerRepo,
    inbox,
    inboxRepo,
    store: schedulingStore,
    calendar: googleCalendar,
    connection: connectionStore,
    publish: bus.publish,
    catalog,
    log: app.log,
  }),
);
await app.register(
  panelAppointmentsRoutes({
    store: schedulingStore,
    inboxRepo,
    inbox,
    customers: customerRepo,
    calendar: googleCalendar,
    connection: connectionStore,
    rules: rulesStore,
    booking,
    catalog,
    reminderLeadMinutes: env.REMINDER_LEAD_MINUTES,
  }),
);
await app.register(
  panelCalendarRoutes({
    connection: connectionStore,
    calendar: googleCalendar,
    rules: rulesStore,
    buildConnectUrl: googleOAuth.buildConnectUrl,
    googleConfigured: googleOAuth.isConfigured,
    // Modo fake: o token da conexão falsa não existe no Google, então não há o que revogar
    revoke: fakeMode ? async () => {} : googleOAuth.revoke,
    fakeMode,
  }),
);
await app.register(
  panelEventsRoutes({
    bus,
    onFirst: () => instance.startPolling((err) => app.log.warn({ err }, "falha ao consultar a conexão")),
    onLast: () => instance.stopPolling(),
  }),
);
// Conhecimento do painel e publicação no RAG (sem INTERNAL_TOKEN, o RAG recusa o /reindex e a publicação dá 502)
await app.register(
  panelKnowledgeRoutes({
    repo: knowledge,
    rag: createRagAdmin({ url: env.RAG_SERVICE_URL, token: env.INTERNAL_TOKEN ?? "" }),
    rules: rulesStore,
    clinic,
    language: clinic.language,
    onChange: () => catalog.refresh(),
  }),
);
await app.register(panelClinicRoutes({ clinic, repo: clinicSettings }));
await app.register(panelStaticRoutes);

// Lembrete pelo WhatsApp antes de cada horário (specs/006 US4)
const reminders = createReminderScheduler({
  store: schedulingStore,
  calendar: googleCalendar,
  connection: connectionStore,
  gate,
  inboxRepo,
  inbox,
  log: app.log,
  leadMinutes: env.REMINDER_LEAD_MINUTES,
  cutoffMinutes: env.REMINDER_CUTOFF_MINUTES,
  tickMs: env.REMINDER_TICK_MS,
  allowOutsideWindow: env.REMINDER_OUTSIDE_WINDOW,
  replies: schedulingReplies,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    instance.stopPolling();
    reminders.stop();
    await app.close();
    await sql.end();
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: "0.0.0.0" });
reminders.start();

// Estado inicial da conexão; a Evolution API fora do ar não impede o servidor de subir.
// Já conectado, o número entra no registro do aquecimento (specs/004 FR-023)
instance
  .refresh()
  .then(({ number }) => (number ? rememberNumber(number) : undefined))
  .catch((err) => app.log.warn({ err: (err as Error).message }, "estado da conexão indisponível"));

// Confere o fuso da agenda conectada com o do Google (todos os horários do agendamento dependem dele)
connectionStore
  .getForUse()
  .then(async (conn) => {
    if (!conn || conn.status !== "connected") return;
    if (await connectionStore.syncCalendar(await googleCalendar.listCalendars())) {
      app.log.warn("fuso ou nome da agenda atualizado a partir do Google");
    }
    const { timeZone } = await connectionStore.get();
    app.log.info({ timeZone }, "agenda Google conectada");
  })
  .catch((err) => app.log.warn({ err: (err as Error).message }, "não foi possível conferir a agenda Google"));
