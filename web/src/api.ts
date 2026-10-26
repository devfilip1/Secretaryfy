// Cliente da API do painel. Contratos: specs/002-whatsapp-web-inbox/contracts/panel-api.md, specs/003-google-calendar-scheduling/contracts/panel-api.md
// e specs/004-whatsapp-anti-ban/contracts/panel-api.md

// "system": registros do Secretaryfy no histórico, como um agendamento feito pelo assistente
export type Origin = "customer" | "assistant" | "operator" | "phone" | "system";
export type MessageType = "text" | "audio" | "image" | "video" | "document" | "sticker" | "location" | "contact" | "other";
// "blocked": a proteção do número não enviou; o código do motivo vem em `error` (specs/004)
export type MessageStatus = "received" | "sending" | "sent" | "failed" | "blocked";

export interface Conversation {
  id: string;
  phone: string;
  name: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  assistantPaused: boolean;
  needsAttention: boolean;
  /** O cliente pediu para não receber mensagens (specs/004) */
  optedOut: boolean;
}

export interface Message {
  id: string;
  origin: Origin;
  type: MessageType;
  text: string | null;
  status: MessageStatus;
  error: string | null;
  sentAt: string;
}

export interface Connection {
  state: "open" | "connecting" | "close";
  number: string | null;
  qr: string | null;
}

/** Estado da proteção do número (specs/004-whatsapp-anti-ban/contracts/panel-api.md). */
export interface Protection {
  state: "normal" | "warmup" | "paused";
  pausedUntil: string | null;
  reason: "send_failures" | "connection_drops" | null;
  warmupUntil: string | null;
  limits: { perMinute: number; perHour: number; conversationsPerDay: number };
  usage: { lastMinute: number; lastHour: number; conversationsToday: number };
}

/** Riscos que o operador precisa confirmar antes de enviar (409 risk_confirmation_required). */
export type SendRisk = "cold_contact" | "opted_out" | "protection_paused";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(`${status} ${error}`);
  }
}

/** Avisado quando a sessão expira (401), para voltar ao login. */
let onUnauthenticated: () => void = () => {};
export function setUnauthenticatedHandler(handler: () => void) {
  onUnauthenticated = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const error = new ApiError(res.status, data.error ?? "unknown", data);
    if (res.status === 401 && path !== "/api/session") onUnauthenticated();
    throw error;
  }
  return data as T;
}

export const login = (password: string) => request<void>("POST", "/api/session", { password });
export const getSession = () => request<{ authenticated: true }>("GET", "/api/session");
export const logout = () => request<void>("DELETE", "/api/session");

export const getConnection = () => request<Connection>("GET", "/api/connection");
export const requestQr = () => request<Connection>("POST", "/api/connection/qr", {});
export const disconnect = () => request<void>("DELETE", "/api/connection");

export const listConversations = (q = "") =>
  request<{ conversations: Conversation[] }>("GET", `/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const listMessages = (id: string, { before, limit = 50 }: { before?: string; limit?: number } = {}) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set("before", before);
  return request<{ conversation: Conversation; messages: Message[]; hasMore: boolean }>(
    "GET",
    `/api/conversations/${id}/messages?${params}`,
  );
};

/** Apaga todas as conversas e as mensagens delas (o número continua conectado). */
export const clearConversations = () => request<{ deleted: number }>("DELETE", "/api/conversations");
export const markRead = (id: string) => request<void>("POST", `/api/conversations/${id}/read`, {});
export const setPaused = (id: string, assistantPaused: boolean) =>
  request<Conversation>("PATCH", `/api/conversations/${id}`, { assistantPaused });
export const sendMessage = (id: string, text: string, confirmRisk = false) =>
  request<{ message: Message }>("POST", `/api/conversations/${id}/messages`, confirmRisk ? { text, confirmRisk } : { text });
export const retryMessage = (id: string, confirmRisk = false) =>
  request<{ message: Message }>("POST", `/api/messages/${id}/retry`, confirmRisk ? { confirmRisk } : {});
export const reactivateMessages = (id: string) => request<Conversation>("PATCH", `/api/conversations/${id}`, { optedOut: false });

/** Riscos de um 409 risk_confirmation_required, ou null se o erro for outro. */
export function risksOf(err: unknown): SendRisk[] | null {
  if (!(err instanceof ApiError) || err.error !== "risk_confirmation_required") return null;
  return Array.isArray(err.body.risks) ? (err.body.risks as SendRisk[]) : [];
}

// --- Proteção do número (specs/004-whatsapp-anti-ban/contracts/panel-api.md) ---

export const getProtection = () => request<Protection>("GET", "/api/protection");

// --- Agenda (specs/003-google-calendar-scheduling/contracts/panel-api.md) ---

export type DayKey = "1" | "2" | "3" | "4" | "5" | "6" | "7";

export type CalendarConnection =
  | { status: "disconnected"; email: null; calendarId: null; calendarName: null; timeZone: null }
  | { status: "connected" | "needs_reauth"; email: string; calendarId: string; calendarName: string; timeZone: string };

export interface CalendarRules {
  weeklyHours: Partial<Record<DayKey, { start: string; end: string }>>;
  slotMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  cancelNoticeMinutes: number;
}

export interface CalendarState {
  connection: CalendarConnection;
  rules: CalendarRules;
}

export interface CalendarOption {
  id: string;
  name: string;
  timeZone: string;
  primary: boolean;
}

export interface RulesIssue {
  path: string;
  message: string;
}

export const getCalendar = () => request<CalendarState>("GET", "/api/calendar");
export const connectCalendar = () => request<{ url: string }>("POST", "/api/calendar/connect", {});
export const listCalendars = () => request<{ calendars: CalendarOption[] }>("GET", "/api/calendar/calendars");
export const selectCalendar = (calendarId: string) => request<CalendarState>("PUT", "/api/calendar/selection", { calendarId });
export const saveRules = (rules: CalendarRules) => request<CalendarState>("PUT", "/api/calendar/rules", rules);
export const disconnectCalendar = () => request<void>("DELETE", "/api/calendar");

// --- Clientes (cadastro feito pelo assistente, specs/005) ---

export interface CustomerAppointment {
  startsAt: string;
  service: string | null;
  status: "booked" | "cancelled";
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  updatedAt: string;
  /** Anotações livres da clínica (specs/006) */
  notes: string | null;
  /** Conversa do telefone no painel, se houver */
  conversationId: string | null;
  /** Mais recentes primeiro */
  appointments: CustomerAppointment[];
}

export const listCustomers = () => request<{ customers: Customer[] }>("GET", "/api/customers");
/** Exclui o cadastro; os agendamentos e o Google Agenda não mudam. */
export const deleteCustomer = (id: string) => request<void>("DELETE", `/api/customers/${id}`);
/** Edita nome e/ou anotações; `calendarUpdated` é false se algum título na agenda não pôde ser trocado. */
export const updateCustomer = (id: string, patch: { name?: string; notes?: string | null }) =>
  request<{ customer: Customer; calendarUpdated: boolean }>("PATCH", `/api/customers/${id}`, patch);

// --- Agendamentos (specs/006-panel-appointments-reminders/contracts/panel-api.md) ---

export type ReminderLabel = "confirmed" | "scheduled" | "remind_manually" | "waiting" | "sent" | "not_sent" | "not_needed";

export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  group: "today" | "tomorrow" | "week";
  customerName: string;
  service: string | null;
  phone: string;
  customerId: string | null;
  notes: string | null;
  conversationId: string | null;
  origin: "assistant" | "panel";
  reminder: { label: ReminderLabel; reason: string | null; sentAt: string | null };
  confirmedAt: string | null;
  confirmedBy: "customer" | "operator" | null;
}

export const listAppointments = () => request<{ timeZone: string; appointments: Appointment[] }>("GET", "/api/appointments");
export const confirmAppointment = (id: string) => request<{ appointment: Appointment }>("POST", `/api/appointments/${id}/confirm`, {});

export const bookingDays = () => request<{ timeZone: string; days: string[] }>("GET", "/api/booking/days");
export const bookingSlots = (date: string) => request<{ date: string; slots: string[] }>("GET", `/api/booking/slots?date=${date}`);
export const lookupPhone = (phone: string) =>
  request<{ phone: string; name: string | null; hasConversation: boolean; futureAppointment: Appointment | null }>(
    "GET",
    `/api/booking/lookup?phone=${encodeURIComponent(phone)}`,
  );
/** Erros 409: slot_taken (body.slots), already_booked (body.appointment), calendar_disconnected; 422: body.issues. */
export const createAppointment = (body: { phone: string; name: string; service: string; start: string }) =>
  request<{ appointment: Appointment }>("POST", "/api/appointments", body);
