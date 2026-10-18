import { db } from "../db/client.js";
import { createGoogleCalendar } from "../modules/google/calendar.js";
import { createConnectionStore } from "../modules/google/connection.js";
import { bus } from "../modules/inbox/events.js";
import { createRulesStore } from "../modules/scheduling/rules.js";

/** Instâncias do processo, compartilhadas pelo webhook (agendamento) e pela API do painel. */
export const connectionStore = createConnectionStore({ db, publish: bus.publish });
export const googleCalendar = createGoogleCalendar({ connection: connectionStore });
export const rulesStore = createRulesStore(db);

/** Agendas de uma conta recém-autorizada, antes de gravar a conexão (callback do OAuth). */
export function listCalendarsFor(refreshToken: string) {
  return createGoogleCalendar({
    connection: {
      getForUse: async () => ({ refreshToken, calendarId: "primary", timeZone: "UTC", status: "connected" }),
      markNeedsReauth: async () => {},
    },
  }).listCalendars();
}
