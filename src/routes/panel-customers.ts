import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CustomerRepository, CustomerWithAppointments } from "../modules/customers/repository.js";
import type { CalendarGateway } from "../modules/google/gateway.js";
import type { Publish } from "../modules/inbox/events.js";
import type { InboxRepository } from "../modules/inbox/repository.js";
import type { InboxService } from "../modules/inbox/service.js";
import { ASSESSMENT } from "../modules/scheduling/services.js";
import type { SchedulingStore } from "../modules/scheduling/sessions.js";

interface Deps {
  customers: Pick<CustomerRepository, "list" | "remove" | "findById" | "update">;
  inbox: Pick<InboxService, "forgetCustomerName" | "setCustomerNameByPhone">;
  inboxRepo: Pick<InboxRepository, "conversationIdsByPhone">;
  /** Horários futuros do cliente, para acompanhar a troca de nome (specs/006 R6) */
  store: Pick<SchedulingStore, "futureBookedByPhone" | "setCustomerName">;
  calendar: Pick<CalendarGateway, "renameEvent">;
  publish: Publish;
  log?: { warn: (obj: object, msg: string) => void };
  now?: () => Date;
}

const idParams = z.object({ id: z.uuid() });
const MAX_NOTES = 1000;
const patchBody = z
  .object({
    name: z.string().trim().min(1, "the name can't be empty").max(120).optional(),
    notes: z.string().max(MAX_NOTES, `notes can have up to ${MAX_NOTES} characters`).nullable().optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.notes !== undefined, "send a name or notes");

function present(row: CustomerWithAppointments, conversationId: string | null) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    conversationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    appointments: row.appointments.map((a) => ({ startsAt: a.startsAt.toISOString(), service: a.service, status: a.status })),
  };
}

export type CustomerJson = ReturnType<typeof present>;

/** Aba Customers do painel: o cadastro feito pelo assistente (specs/005), para consultar, editar (specs/006) e excluir. */
export function panelCustomersRoutes({ customers, inbox, inboxRepo, store, calendar, publish, log = console, now = () => new Date() }: Deps) {
  async function presentAll() {
    const rows = await customers.list();
    const conversations = await inboxRepo.conversationIdsByPhone(rows.map((r) => r.phone));
    return rows.map((r) => present(r, conversations.get(r.phone) ?? null));
  }

  /**
   * O nome novo vale para a conversa e para os horários futuros, inclusive no título do evento (FR-007, FR-008). Uma
   * falha no Google não desfaz nada: devolve false para o painel avisar.
   */
  async function propagateName(phone: string, name: string): Promise<boolean> {
    await inbox.setCustomerNameByPhone(phone, name);
    let calendarUpdated = true;
    for (const appt of await store.futureBookedByPhone(phone, now())) {
      await store.setCustomerName(appt.id, name);
      try {
        await calendar.renameEvent(appt.googleEventId, `${name} — ${appt.service ?? ASSESSMENT}`);
      } catch (err) {
        calendarUpdated = false;
        log.warn({ appointmentId: appt.id, err }, "não foi possível renomear o evento na agenda");
      }
    }
    return calendarUpdated;
  }

  return async function (app: FastifyInstance) {
    app.get("/api/customers", async () => ({ customers: await presentAll() }));

    app.patch("/api/customers/:id", async (req, reply) => {
      const params = idParams.safeParse(req.params);
      const current = params.success ? await customers.findById(params.data.id) : null;
      if (!current) return reply.code(404).send({ error: "not_found" });

      const body = patchBody.safeParse(req.body);
      if (!body.success) {
        const issues = body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
        return reply.code(422).send({ error: "invalid_body", issues });
      }
      const { name, notes } = body.data;
      const patch = {
        ...(name !== undefined ? { name } : {}),
        // Anotação vazia ou só com espaços apaga a anotação
        ...(notes !== undefined ? { notes: notes?.trim() ? notes : null } : {}),
      };
      await customers.update(current.id, patch, now());

      const renamed = name !== undefined && name !== current.name;
      const calendarUpdated = renamed ? await propagateName(current.phone, name) : true;
      publish({ type: "customers.updated" });

      const customer = (await presentAll()).find((c) => c.id === current.id)!;
      return { customer, calendarUpdated };
    });

    // Exclui o cadastro e faz a conversa do número esquecer o nome; os agendamentos e o Google Agenda não mudam
    app.delete("/api/customers/:id", async (req, reply) => {
      const params = idParams.safeParse(req.params);
      const removed = params.success ? await customers.remove(params.data.id) : null;
      if (!removed) return reply.code(404).send({ error: "not_found" });
      await inbox.forgetCustomerName(removed.phone);
      publish({ type: "customers.updated" });
      return reply.code(204).send();
    });
  };
}
