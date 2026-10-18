// Agenda em memória com a interface CalendarGateway, para os testes do agendamento.
import { CalendarUnavailable, type CalendarGateway, type CalendarOption, type Interval, type NewEvent } from "../modules/google/gateway.js";

export interface FakeEvent extends NewEvent {
  id: string;
}

export function createFakeCalendar({
  calendars = [{ id: "primary", name: "DentalSafe", timeZone: "America/Bahia", primary: true }],
}: { calendars?: CalendarOption[] } = {}) {
  const events = new Map<string, FakeEvent>();
  /** Ocupações que não são eventos do Secretaryfy (compromissos criados direto no Google). */
  const blocks: Interval[] = [];
  const calls: Record<keyof CalendarGateway, number> = {
    listCalendars: 0,
    busy: 0,
    createEvent: 0,
    getEvent: 0,
    moveEvent: 0,
    deleteEvent: 0,
  };
  let nextError: Error | null = null;
  let seq = 0;
  /** Chamado dentro de busy(), antes de responder: simula alguém ocupando o horário nesse meio-tempo. */
  let onBusy: (() => void) | null = null;

  function maybeFail(method: keyof CalendarGateway) {
    calls[method]++;
    if (nextError) {
      const err = nextError;
      nextError = null;
      throw err;
    }
  }

  const gateway: CalendarGateway = {
    async listCalendars() {
      maybeFail("listCalendars");
      return calendars;
    },
    async busy(from, to) {
      maybeFail("busy");
      onBusy?.();
      return [...blocks, ...[...events.values()].map((e) => ({ start: e.start, end: e.end }))]
        .filter((i) => i.start < to && i.end > from)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    },
    async createEvent(event) {
      maybeFail("createEvent");
      const id = `evt${++seq}`;
      events.set(id, { ...event, id });
      return { eventId: id };
    },
    async getEvent(eventId) {
      maybeFail("getEvent");
      const e = events.get(eventId);
      return e ? { start: e.start, end: e.end } : null;
    },
    async moveEvent(eventId, start, end) {
      maybeFail("moveEvent");
      const e = events.get(eventId);
      if (!e) throw new CalendarUnavailable("evento não encontrado");
      events.set(eventId, { ...e, start, end });
    },
    async deleteEvent(eventId) {
      maybeFail("deleteEvent");
      events.delete(eventId);
    },
  };

  return {
    gateway,
    events,
    calls,
    /** Ocupa um intervalo como se fosse um compromisso criado direto no Google. */
    block(start: Date, end: Date) {
      blocks.push({ start, end });
    },
    /** A próxima chamada lança este erro. */
    failNext(error: Error = new CalendarUnavailable("Google fora do ar")) {
      nextError = error;
    },
    onBusy(fn: (() => void) | null) {
      onBusy = fn;
    },
  };
}

export type FakeCalendar = ReturnType<typeof createFakeCalendar>;
