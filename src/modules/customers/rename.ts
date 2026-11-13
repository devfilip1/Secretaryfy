import type { ClinicContext } from "../clinic/context.js";
import type { CalendarGateway } from "../google/gateway.js";
import type { InboxService } from "../inbox/service.js";
import { ASSESSMENT, type ServiceCatalog } from "../scheduling/catalog.js";
import type { SchedulingStore } from "../scheduling/sessions.js";

interface Deps {
  inbox: Pick<InboxService, "setCustomerNameByPhone">;
  store: Pick<SchedulingStore, "futureBookedByPhone" | "setCustomerName">;
  calendar: Pick<CalendarGateway, "renameEvent">;
  catalog: Pick<ServiceCatalog, "label">;
  clinic: Pick<ClinicContext, "language">;
  log?: { warn: (obj: object, msg: string) => void };
  now?: () => Date;
}

/**
 * Troca do nome de um cliente (painel): vale para a conversa e para os horários futuros, inclusive no título do evento
 * (specs/006 R6). Usado pelo cadastro e pela edição de um horário. Uma falha no Google não desfaz nada: devolve false
 * para o painel avisar.
 */
export function createCustomerRename({ inbox, store, calendar, catalog, clinic, log = console, now = () => new Date() }: Deps) {
  return {
    async propagateName(phone: string, name: string): Promise<boolean> {
      await inbox.setCustomerNameByPhone(phone, name);
      let calendarUpdated = true;
      for (const appt of await store.futureBookedByPhone(phone, now())) {
        await store.setCustomerName(appt.id, name);
        try {
          await calendar.renameEvent(appt.googleEventId, `${name} — ${catalog.label(appt.service ?? ASSESSMENT, clinic.language)}`);
        } catch (err) {
          calendarUpdated = false;
          log.warn({ appointmentId: appt.id, err }, "não foi possível renomear o evento na agenda");
        }
      }
      return calendarUpdated;
    },
  };
}
