/** Agenda usada pelo agendamento (contracts/google-calendar.md). Sempre a agenda escolhida em calendar_connection. */
export interface CalendarGateway {
  /** Agendas em que a conta pode criar eventos. */
  listCalendars(): Promise<CalendarOption[]>;
  /** Intervalos ocupados entre `from` e `to`. Eventos marcados como "disponível" não entram. */
  busy(from: Date, to: Date): Promise<Interval[]>;
  createEvent(event: NewEvent): Promise<{ eventId: string }>;
  /** null quando o evento foi apagado. */
  getEvent(eventId: string): Promise<Interval | null>;
  moveEvent(eventId: string, start: Date, end: Date): Promise<void>;
  /** Troca só o título do evento (nome do cliente editado, specs/006). Sem erro se o evento já não existe. */
  renameEvent(eventId: string, summary: string): Promise<void>;
  /** Sem erro se o evento já não existe. */
  deleteEvent(eventId: string): Promise<void>;
}

/**
 * Fuso usado quando o Google não informa o da agenda. Antes era UTC, e um agendamento pedido para as 10h
 * foi parar às 7h de Brasília; a clínica está no Brasil.
 */
export const FALLBACK_TIME_ZONE = "America/Sao_Paulo";

export interface Interval {
  start: Date;
  end: Date;
}

export interface CalendarOption {
  id: string;
  name: string;
  timeZone: string;
  primary: boolean;
}

export interface NewEvent {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  /** Vão para extendedProperties.private */
  properties: Record<string, string>;
}

/** A agenda não respondeu, está desconectada ou recusou a chamada. */
export class CalendarUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CalendarUnavailable";
  }
}

/** O Google recusou o acesso: a conexão passa a precisar de reconexão (US3, cenário 6). */
export class CalendarAuthError extends CalendarUnavailable {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CalendarAuthError";
  }
}
