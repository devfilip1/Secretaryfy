import type { FastifyInstance, FastifyReply } from "fastify";
import { DateTime } from "luxon";
import { z } from "zod";
import type { AppointmentRow } from "../db/schema.js";
import type { CustomerRepository } from "../modules/customers/repository.js";
import type { ConnectionStore } from "../modules/google/connection.js";
import { CalendarUnavailable, FALLBACK_TIME_ZONE, type CalendarGateway } from "../modules/google/gateway.js";
import type { InboxRepository } from "../modules/inbox/repository.js";
import type { InboxService } from "../modules/inbox/service.js";
import { reminderLabel } from "../modules/reminders/status.js";
import { availableDays, bookingWindow, slotsForDay } from "../modules/scheduling/availability.js";
import type { Booking } from "../modules/scheduling/booking.js";
import { normalizePhone } from "../modules/scheduling/phone.js";
import { systemNotes } from "../modules/scheduling/replies.js";
import type { RulesStore } from "../modules/scheduling/rules.js";
import { SERVICES } from "../modules/scheduling/services.js";
import type { SchedulingStore, UpcomingAppointment } from "../modules/scheduling/sessions.js";

interface Deps {
  store: Pick<SchedulingStore, "listUpcoming" | "findAppointment" | "confirm">;
  inboxRepo: Pick<InboxRepository, "conversationIdsByPhone" | "findConversationByPhone">;
  inbox: Pick<InboxService, "recordSystem">;
  customers: Pick<CustomerRepository, "findByPhone">;
  calendar: Pick<CalendarGateway, "busy">;
  connection: Pick<ConnectionStore, "getForUse">;
  rules: Pick<RulesStore, "get">;
  booking: Pick<Booking, "bookSlot" | "currentAppointment">;
  reminderLeadMinutes: number;
  now?: () => Date;
}

const idParams = z.object({ id: z.uuid() });
const slotsQuery = z.object({ date: z.iso.date() });
const lookupQuery = z.object({ phone: z.string() });
const SERVICE_NAMES = SERVICES.map((s) => s.name);
const bookBody = z.object({
  phone: z.string().transform((v, ctx) => {
    const phone = normalizePhone(v);
    if (!phone) ctx.addIssue({ code: "custom", message: "enter a phone number with area code" });
    return phone ?? "";
  }),
  name: z.string().trim().min(1, "enter the customer's name").max(120),
  service: z.string().refine((v) => SERVICE_NAMES.includes(v), "choose one of the clinic's services"),
  start: z.iso.datetime({ offset: true }),
});

type Group = "today" | "tomorrow" | "week";

/** Aba Appointments e marcação pelo painel (specs/006 contracts/panel-api.md). */
export function panelAppointmentsRoutes({
  store,
  inboxRepo,
  inbox,
  customers,
  calendar,
  connection,
  rules: rulesStore,
  booking,
  reminderLeadMinutes,
  now: clock = () => new Date(),
}: Deps) {
  /** Fuso da agenda conectada; sem agenda, o de reserva. */
  async function timeZoneOf() {
    return (await connection.getForUse())?.timeZone ?? FALLBACK_TIME_ZONE;
  }

  function present(appt: AppointmentRow | UpcomingAppointment, extra: { now: Date; timeZone: string; conversationId: string | null }) {
    const { now, timeZone, conversationId } = extra;
    const day = DateTime.fromJSDate(appt.startsAt, { zone: timeZone }).startOf("day");
    const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
    const diff = Math.round(day.diff(today, "days").days);
    const group: Group = diff <= 0 ? "today" : diff === 1 ? "tomorrow" : "week";
    return {
      id: appt.id,
      startsAt: appt.startsAt.toISOString(),
      endsAt: appt.endsAt.toISOString(),
      group,
      customerName: "registeredName" in appt && appt.registeredName ? appt.registeredName : appt.customerName,
      service: appt.service,
      phone: appt.phone,
      customerId: appt.customerId,
      notes: "notes" in appt ? appt.notes : null,
      conversationId,
      origin: appt.origin,
      reminder: {
        label: reminderLabel(appt, now, { leadMinutes: reminderLeadMinutes }),
        reason: appt.reminderReason,
        sentAt: appt.reminderSentAt?.toISOString() ?? null,
      },
      confirmedAt: appt.confirmedAt?.toISOString() ?? null,
      confirmedBy: appt.confirmedBy,
    };
  }

  async function presentOne(appt: AppointmentRow) {
    const conversation = await inboxRepo.findConversationByPhone(appt.phone);
    return present(appt, { now: clock(), timeZone: await timeZoneOf(), conversationId: conversation?.id ?? null });
  }

  /** Agenda pronta para marcar; senão responde 409 e devolve null. */
  async function usableCalendar(reply: FastifyReply) {
    const conn = await connection.getForUse();
    if (!conn || conn.status !== "connected") {
      reply.code(409).send({ error: "calendar_disconnected" });
      return null;
    }
    return conn;
  }

  /** Regras, ocupação e janela para calcular horários livres, como o assistente (FR-013). */
  async function availabilityContext(timeZone: string) {
    const rules = await rulesStore.get();
    const now = clock();
    const window = bookingWindow({ rules, now, timeZone });
    const busy = await calendar.busy(window.from, window.to);
    return { rules, now, timeZone, busy, window };
  }

  async function slotsOn(date: string, timeZone: string) {
    const ctx = await availabilityContext(timeZone);
    return slotsForDay(date, ctx).map((s) => s.toISOString());
  }

  /** Erros do Google viram 502; o resto segue. */
  async function guard<T>(reply: FastifyReply, run: () => Promise<T>): Promise<T | FastifyReply> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof CalendarUnavailable) return reply.code(502).send({ error: "calendar_unavailable" });
      throw err;
    }
  }

  return async function (app: FastifyInstance) {
    // --- Aba Appointments (US1) ---

    app.get("/api/appointments", async () => {
      const now = clock();
      const timeZone = await timeZoneOf();
      // Até o fim do 7º dia seguinte, no fuso da clínica
      const to = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day").plus({ days: 8 }).toJSDate();
      const rows = await store.listUpcoming(now, to);
      const conversations = await inboxRepo.conversationIdsByPhone(rows.map((r) => r.phone));
      return {
        timeZone,
        appointments: rows.map((r) => present(r, { now, timeZone, conversationId: conversations.get(r.phone) ?? null })),
      };
    });

    // O operador confirma o horário, por exemplo depois de ligar para o cliente (US4, FR-022a)
    app.post("/api/appointments/:id/confirm", async (req, reply) => {
      const params = idParams.safeParse(req.params);
      const now = clock();
      const current = params.success ? await store.findAppointment(params.data.id) : null;
      if (!current || current.status !== "booked" || current.startsAt <= now) return reply.code(404).send({ error: "not_found" });

      const confirmed = (await store.confirm(current.id, "operator", now))!;
      if (!current.confirmedAt) {
        const conversation = await inboxRepo.findConversationByPhone(current.phone);
        if (conversation) await inbox.recordSystem(conversation.id, systemNotes.confirmedByOperator(current.startsAt, await timeZoneOf()));
      }
      return { appointment: await presentOne(confirmed) };
    });

    // --- Marcar pelo painel (US3) ---

    app.get("/api/booking/days", async (_req, reply) => {
      const conn = await usableCalendar(reply);
      if (!conn) return reply;
      return guard(reply, async () => {
        const ctx = await availabilityContext(conn.timeZone);
        return { timeZone: conn.timeZone, days: availableDays(ctx) };
      });
    });

    app.get("/api/booking/slots", async (req, reply) => {
      const query = slotsQuery.safeParse(req.query);
      if (!query.success) return reply.code(422).send({ error: "invalid_date" });
      const conn = await usableCalendar(reply);
      if (!conn) return reply;
      return guard(reply, async () => ({ date: query.data.date, slots: await slotsOn(query.data.date, conn.timeZone) }));
    });

    app.get("/api/booking/lookup", async (req, reply) => {
      const query = lookupQuery.safeParse(req.query);
      const phone = query.success ? normalizePhone(query.data.phone) : null;
      if (!phone) return reply.code(422).send({ error: "invalid_phone" });
      const conversation = await inboxRepo.findConversationByPhone(phone);
      const customer = await customers.findByPhone(phone);
      return guard(reply, async () => {
        const future = await booking.currentAppointment(phone, conversation?.id ?? null);
        return {
          phone,
          name: customer?.name ?? conversation?.customerName ?? null,
          hasConversation: Boolean(conversation),
          futureAppointment: future ? await presentOne(future) : null,
        };
      });
    });

    app.post("/api/appointments", async (req, reply) => {
      const body = bookBody.safeParse(req.body);
      if (!body.success) {
        const issues = body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
        return reply.code(422).send({ error: "invalid_body", issues });
      }
      const { phone, name, service, start } = body.data;
      const conversation = await inboxRepo.findConversationByPhone(phone);

      return guard(reply, async () => {
        const result = await booking.bookSlot({
          phone,
          name,
          service,
          start: new Date(start),
          origin: "panel",
          conversationId: conversation?.id ?? null,
        });
        switch (result.kind) {
          case "booked":
            return reply.code(201).send({ appointment: await presentOne(result.appointment) });
          case "already_booked":
            return reply.code(409).send({ error: "already_booked", appointment: await presentOne(result.appointment) });
          case "calendar_unavailable":
            return reply.code(409).send({ error: "calendar_disconnected" });
          case "slot_taken": {
            const timeZone = await timeZoneOf();
            const date = DateTime.fromISO(start, { zone: timeZone }).toISODate()!;
            return reply.code(409).send({ error: "slot_taken", date, slots: await slotsOn(date, timeZone) });
          }
        }
      });
    });
  };
}