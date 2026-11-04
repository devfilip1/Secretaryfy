import { count } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { appointments } from "../db/schema.js";
import { createGoogleCalendar } from "../modules/google/calendar.js";
import { createConnectionStore } from "../modules/google/connection.js";
import { createFakeCalendar } from "../modules/google/fake-calendar.js";
import { prepareFakeCalendar } from "../modules/google/fake-mode.js";
import { bus } from "../modules/inbox/events.js";
import { createRulesStore } from "../modules/scheduling/rules.js";

/** Instâncias do processo, compartilhadas pelo webhook (agendamento) e pela API do painel. */
export const connectionStore = createConnectionStore({ db, publish: bus.publish });

/** Modo CALENDAR_MODE=fake: agenda em memória. Nesse modo, googleCalendar é o gateway falso (o nome é mantido nos chamadores). */
const fakeCalendar = env.CALENDAR_MODE === "fake" ? createFakeCalendar() : null;
export const googleCalendar = fakeCalendar ? fakeCalendar.gateway : createGoogleCalendar({ connection: connectionStore });
export const rulesStore = createRulesStore(db);

/** Modo fake: deixa a conexão conectada com a agenda falsa (idempotente). Chamado pelo index.ts depois que o banco está pronto. */
export async function startFakeCalendar() {
  if (!fakeCalendar) throw new Error("startFakeCalendar só existe no modo fake");
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
  }).listCalendars();
}
