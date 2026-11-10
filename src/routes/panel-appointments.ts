import type { FastifyInstance, FastifyReply } from "fastify";
import { DateTime } from "luxon";
import { z } from "zod";
import type { AppointmentRow } from "../db/schema.js";
import type { CustomerRepository } from "../modules/customers/repository.js";
import { clinicTimeZone, type ConnectionStore } from "../modules/google/connection.js";
import { CalendarUnavailable, type CalendarGateway } from "../modules/google/gateway.js";
import type { InboxRepository } from "../modules/inbox/repository.js";
import type { InboxService } from "../modules/inbox/service.js";
import { reminderLabel } from "../modules/reminders/status.js";
import {
  availableDays,
  bookingWindow,
  dayStatuses,
  MAX_APPOINTMENT_MINUTES,
  MINUTES_STEP,
  naturalSlotsForDay,
  startsWithRoom,
  STAFF_MAX_DAYS_AHEAD,
} from "../modules/scheduling/availability.js";
import type { Booking } from "../modules/scheduling/booking.js";
import { normalizePhone } from "../modules/scheduling/phone.js";
import { systemNotes } from "../modules/scheduling/replies.js";
import type { RulesStore } from "../modules/scheduling/rules.js";
import { ASSESSMENT, type ServiceCatalog } from "../modules/scheduling/catalog.js";
import type { SchedulingStore, UpcomingAppointment } from "../modules/scheduling/sessions.js";

interface Deps {
  store: Pick<SchedulingStore, "listUpcoming" | "findAppointment" | "confirm">;
  inboxRepo: Pick<InboxRepository, "conversationIdsByPhone" | "findConversationByPhone">;
  inbox: Pick<InboxService, "recordSystem">;
  customers: Pick<CustomerRepository, "findByPhone">;
  calendar: Pick<CalendarGateway, "busy">;
  connection: Pick<ConnectionStore, "getForUse">;
  rules: Pick<RulesStore, "get">;
  booking: Pick<Booking, "bookSlot" | "currentAppointment" | "cancelAppointment">;
  reminderLeadMinutes: number;
  /** Os tratamentos que se podem marcar (catalog.ts): a lista do painel e a validação da marcação */
  catalog: ServiceCatalog;
  now?: () => Date;
}

const idParams = z.object({ id: z.uuid() });
const slotsQuery = z.object({ date: z.iso.date(), service: z.string().optional() });
const startsQuery = z.object({ date: z.iso.date() });
const daysQuery = z.object({ service: z.string().optional() });
const lookupQuery = z.object({ phone: z.string() });

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
  catalog,
  now: clock = () => new Date(),
}: Deps) {
  /** Fuso da agenda conectada; sem agenda, o de reserva. */
  const timeZoneOf = () => clinicTimeZone(connection);

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
      // O tempo bloqueado de verdade na agenda, em minutos
      minutes: (appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000,
      group,
      customerName: "registeredName" in appt && appt.registeredName ? appt.registeredName : appt.customerName,
      // O título do tratamento; sem serviço guardado é avaliação geral, como no fluxo
      service: catalog.label(appt.service ?? ASSESSMENT),
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

  /**
   * Regras, ocupação e janela para calcular horários livres, como o assistente (FR-013), com a janela da equipe
   * (um ano): a ocupação cobre os dias que o painel pode marcar.
   */
  async function availabilityContext(timeZone: string) {
    const rules = await rulesStore.get();
    const now = clock();
    const window = bookingWindow({ rules, now, timeZone, maxDaysAhead: STAFF_MAX_DAYS_AHEAD });
    const busy = await calendar.busy(window.from, window.to);
    return { rules, now, timeZone, busy, window, maxDaysAhead: STAFF_MAX_DAYS_AHEAD };
  }

  /**
   * Os horários oferecidos no dia, na duração pedida: a do tratamento, a padrão, ou a escolhida pela equipe (ADR 0015),
   * como o assistente os oferece. Devolve a duração usada.
   */
  async function slotsOn(date: string, timeZone: string, { service, minutes: asked }: { service?: string; minutes?: number } = {}) {
    const ctx = await availabilityContext(timeZone);
    const minutes = asked ?? (service ? catalog.minutes(service) : undefined) ?? ctx.rules.slotMinutes;
    return { minutes, slots: naturalSlotsForDay(date, { ...ctx, minutes }).map((s) => s.toISOString()) };
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

  // Serviço da marcação: tem de estar no catálogo, consultado a cada pedido
  const bookBody = z.object({
    phone: z.string().transform((v, ctx) => {
      const phone = normalizePhone(v);
      if (!phone) ctx.addIssue({ code: "custom", message: "enter a phone number with area code" });
      return phone ?? "";
    }),
    name: z.string().trim().min(1, "enter the customer's name").max(120),
    service: z.string().refine((v) => catalog.list().some((s) => s.name === v), "choose one of the clinic's services"),
    start: z.iso.datetime({ offset: true }),
    // Só a equipe escolhe a duração: de 5 em 5 minutos, até 480
    minutes: z.number().int().min(MINUTES_STEP).max(MAX_APPOINTMENT_MINUTES).multipleOf(MINUTES_STEP).optional(),
  });

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

    // Lista de serviços do painel: a mesma do assistente, com o rótulo em inglês
    app.get("/api/services", async () => ({ services: catalog.panelList() }));

    // Com `service`, os dias valem para a duração do tratamento; sem ele, a duração padrão
    app.get("/api/booking/days", async (req, reply) => {
      const query = daysQuery.safeParse(req.query);
      if (!query.success) return reply.code(422).send({ error: "invalid_query" });
      const conn = await usableCalendar(reply);
      if (!conn) return reply;
      return guard(reply, async () => {
        const ctx = await availabilityContext(conn.timeZone);
        const minutes = query.data.service ? catalog.minutes(query.data.service) : undefined;
        // Os dias do chip são os da janela do paciente; o estado de cada dia cobre até maxDate
        const { window } = ctx;
        return {
          timeZone: conn.timeZone,
          days: availableDays({ ...ctx, minutes, maxDaysAhead: undefined }),
          minDate: window.firstDate,
          maxDate: window.lastDate,
          status: dayStatuses({ ...ctx, minutes }),
        };
      });
    });

    app.get("/api/booking/slots", async (req, reply) => {
      const query = slotsQuery.safeParse(req.query);
      if (!query.success) return reply.code(422).send({ error: "invalid_date" });
      const conn = await usableCalendar(reply);
      if (!conn) return reply;
      return guard(reply, async () => {
        const { minutes, slots } = await slotsOn(query.data.date, conn.timeZone, { service: query.data.service });
        return { date: query.data.date, slots, minutes };
      });
    });

    // Inícios do dia com a duração máxima de cada um, para o painel oferecer a duração livre (até o próximo horário)
    app.get("/api/booking/starts", async (req, reply) => {
      const query = startsQuery.safeParse(req.query);
      if (!query.success) return reply.code(422).send({ error: "invalid_date" });
      const conn = await usableCalendar(reply);
      if (!conn) return reply;
      return guard(reply, async () => {
        const starts = startsWithRoom(query.data.date, await availabilityContext(conn.timeZone));
        return {
          date: query.data.date,
          starts: starts.map(({ start, maxMinutes }) => ({ start: start.toISOString(), maxMinutes })),
        };
      });
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
      const { phone, name, service, start, minutes } = body.data;
      const conversation = await inboxRepo.findConversationByPhone(phone);

      return guard(reply, async () => {
        const result = await booking.bookSlot({
          phone,
          name,
          service,
          start: new Date(start),
          origin: "panel",
          conversationId: conversation?.id ?? null,
          minutes,
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
            const { slots } = await slotsOn(date, timeZone, { service, minutes });
            return reply.code(409).send({ error: "slot_taken", date, slots });
          }
        }
      });
    });

    // Cancelamento pela equipe: sem prazo e sem mensagem ao cliente; a aba recebe o aviso pelo SSE (withAppointmentEvents)
    app.post("/api/appointments/:id/cancel", async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) return reply.code(404).send({ error: "not_found" });
      const current = await store.findAppointment(params.data.id);
      const conversation = current ? await inboxRepo.findConversationByPhone(current.phone) : null;

      return guard(reply, async () => {
        const result = await booking.cancelAppointment({ id: params.data.id, by: "staff", conversationId: conversation?.id ?? null });
        switch (result.kind) {
          case "cancelled":
            return { ok: true };
          case "not_found":
            return reply.code(404).send({ error: "not_found" });
          case "calendar_unavailable":
            return reply.code(409).send({ error: "calendar_disconnected" });
        }
      });
    });
  };
}