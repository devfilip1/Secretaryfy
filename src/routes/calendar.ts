import { and, count, eq, gt } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { appointments } from "../db/schema.js";
import { createGoogleCalendar } from "../modules/google/calendar.js";
import { createConnectionStore } from "../modules/google/connection.js";
import { createFakeCalendar } from "../modules/google/fake-calendar.js";
import { prepareFakeCalendar } from "../modules/google/fake-mode.js";
import { createGoogleOAuth } from "../modules/google/oauth.js";
import { bus } from "../modules/inbox/events.js";
import { createRulesStore } from "../modules/scheduling/rules.js";

/** Instâncias do processo, compartilhadas pelo webhook (agendamento) e pela API do painel. */
export const connectionStore = createConnectionStore({ db, publish: bus.publish });

/** Modo CALENDAR_MODE=fake: agenda em memória. Nesse modo, googleCalendar é o gateway falso (o nome é mantido nos chamadores). */
const fakeCalendar = env.CALENDAR_MODE === "fake" ? createFakeCalendar() : null;
/** Credenciais do Google e o endereço de volta do OAuth, lidos do ambiente só aqui. */
export const googleOAuth = createGoogleOAuth({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  redirectUri: `${env.PUBLIC_URL}/auth/google/callback`,
});
export const googleCalendar = fakeCalendar
  ? fakeCalendar.gateway
  : createGoogleCalendar({ connection: connectionStore, authClientFor: googleOAuth.authClientFor });
export const rulesStore = createRulesStore(db);

/** Modo fake: deixa a conexão conectada com a agenda falsa (idempotente). Chamado pelo index.ts depois que o banco está pronto. */
export async function startFakeCalendar() {
  if (!fakeCalendar) throw new Error("startFakeCalendar só existe no modo fake");
  // A agenda em memória nasce vazia: os horários futuros do banco voltam a ocupá-la, com o mesmo id de evento
  const upcoming = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.status, "booked"), gt(appointments.endsAt, new Date())));
  for (const row of upcoming) {
    fakeCalendar.events.set(row.googleEventId, {
      id: row.googleEventId,
      summary: row.customerName,
      description: "",
      start: row.startsAt,
      end: row.endsAt,
      timeZone: "UTC",
      properties: {},
    });
  }
  return prepareFakeCalendar({
    connection: connectionStore,
    calendars: await fakeCalendar.gateway.listCalendars(),
    countAppointments: async () => (await db.select({ n: count() }).from(appointments))[0]?.n ?? 0,
  });
}

/** Agendas de uma conta recém-autorizada, antes de gravar a conexão (callback do OAuth). */
export function listCalendarsFor(refreshToken: string) {
  if (fakeCalendar) return fakeCalendar.gateway.listCalendars();
  return createGoogleCalendar({
    connection: {
      getForUse: async () => ({ refreshToken, calendarId: "primary", timeZone: "UTC", status: "connected" }),
      markNeedsReauth: async () => {},
    },
    authClientFor: googleOAuth.authClientFor,
  }).listCalendars();
}
