import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// "system": registros do Secretaryfy no histórico (ex.: agendamento feito), nunca enviados ao WhatsApp
export const messageOrigin = pgEnum("message_origin", ["customer", "assistant", "operator", "phone", "system"]);
export const messageType = pgEnum("message_type", [
  "text",
  "audio",
  "image",
  "video",
  "document",
  "sticker",
  "location",
  "contact",
  "other",
]);
// "blocked": resposta que a proteção do número não enviou; o motivo fica em `error` (specs/004)
export const messageStatus = pgEnum("message_status", ["received", "sending", "sent", "failed", "blocked"]);

/** Uma conversa por número de cliente (painel web). */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull().unique(),
    name: text("name"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    lastMessagePreview: text("last_message_preview").notNull(),
    unreadCount: integer("unread_count").notNull().default(0),
    assistantPaused: boolean("assistant_paused").notNull().default(false),
    // O assistente desistiu de entender o cliente e a conversa espera o operador (specs/003, FR-024b)
    needsAttention: boolean("needs_attention").notNull().default(false),
    // Nome que o cliente disse na conversa; `name` é o do perfil do WhatsApp (specs/005, research.md R1)
    customerName: text("customer_name"),
    // Quando o assistente pediu o nome fora do agendamento; impede pedir de novo (specs/005 FR-005)
    nameAskedAt: timestamp("name_asked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_last_message_at_idx").on(t.lastMessageAt.desc())],
);

/** Toda mensagem individual recebida ou enviada pelo número conectado. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Fica null só enquanto um envio está em "sending"; é o que impede o mesmo evento de entrar duas vezes
    waMessageId: text("wa_message_id").unique(),
    origin: messageOrigin("origin").notNull(),
    type: messageType("type").notNull(),
    text: text("text"),
    status: messageStatus("status").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // created_at desempata mensagens do mesmo segundo (o horário do WhatsApp vem em segundos)
    index("messages_conversation_sent_at_idx").on(t.conversationId, t.sentAt.desc(), t.createdAt.desc(), t.id.desc()),
    // Contagens da proteção: envios do sistema já feitos (specs/004, research.md R2)
    index("messages_outgoing_sent_at_idx")
      .on(t.sentAt.desc())
      .where(sql`${t.origin} in ('assistant', 'operator') and ${t.status} = 'sent'`),
  ],
);

export const calendarStatus = pgEnum("calendar_status", ["connected", "needs_reauth"]);

/** A agenda Google da clínica. Uma linha só; sem linha, a agenda está desconectada. */
export const calendarConnection = pgTable(
  "calendar_connection",
  {
    id: smallint("id").primaryKey().default(1),
    email: text("email").notNull(),
    // Criptografado com encrypt() de src/config/crypto.ts
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    scopes: text("scopes").notNull(),
    calendarId: text("calendar_id").notNull(),
    calendarName: text("calendar_name").notNull(),
    timeZone: text("time_zone").notNull(),
    status: calendarStatus("status").notNull().default("connected"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("calendar_connection_single_row", sql`${t.id} = 1`)],
);

/** Horários por dia da semana, de "1" (segunda) a "7" (domingo). Dia ausente = sem atendimento. */
export type WeeklyHours = Partial<Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", { start: string; end: string }>>;

/** Regras de atendimento. Uma linha só, criada com os padrões na primeira leitura. */
export const schedulingRules = pgTable(
  "scheduling_rules",
  {
    id: smallint("id").primaryKey().default(1),
    weeklyHours: jsonb("weekly_hours").$type<WeeklyHours>().notNull(),
    slotMinutes: integer("slot_minutes").notNull(),
    minNoticeMinutes: integer("min_notice_minutes").notNull(),
    maxDaysAhead: integer("max_days_ahead").notNull(),
    cancelNoticeMinutes: integer("cancel_notice_minutes").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("scheduling_rules_single_row", sql`${t.id} = 1`)],
);

/** Cadastro de clientes: quem já confirmou um horário. Sem FK para as conversas, sobrevive à limpeza (specs/005). */
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(),
  name: text("name").notNull(),
  // Anotações livres da clínica, só para o painel; nunca chegam ao assistente (specs/006 FR-010)
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appointmentStatus = pgEnum("appointment_status", ["booked", "cancelled"]);
// Lembrete 24 h antes (specs/006, data-model.md)
export const reminderStatus = pgEnum("reminder_status", ["pending", "sent", "not_sent", "not_needed"]);

/** Agendamentos feitos pelo assistente ou pelo painel. O Google Agenda é a fonte da verdade (FR-018a). */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Onde o horário nasceu; apagar a conversa não apaga o horário (specs/006 R1)
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    // Telefone do cliente: a chave do horário (um futuro por número; a conversa é achada por ele)
    phone: text("phone").notNull(),
    origin: text("origin").$type<"assistant" | "panel">().notNull().default("assistant"),
    googleEventId: text("google_event_id").notNull().unique(),
    calendarId: text("calendar_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    customerName: text("customer_name").notNull(),
    // Serviço do catálogo (specs/005); nulo nos agendamentos anteriores
    service: text("service"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    status: appointmentStatus("status").notNull().default("booked"),
    // customer (pelo WhatsApp) ou calendar (apagado direto no Google)
    cancelledBy: text("cancelled_by"),
    reminderStatus: reminderStatus("reminder_status").notNull().default("not_needed"),
    // Último motivo de espera ou de não envio do lembrete (motivos do portão, no_conversation, too_late)
    reminderReason: text("reminder_reason"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").$type<"customer" | "operator">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Segunda barreira contra dois agendamentos no mesmo horário (research.md R9)
    uniqueIndex("appointments_booked_start_uq").on(t.calendarId, t.startsAt).where(sql`${t.status} = 'booked'`),
    index("appointments_conversation_idx").on(t.conversationId, t.startsAt.desc()),
    index("appointments_phone_idx").on(t.phone, t.startsAt),
    index("appointments_reminder_idx").on(t.reminderStatus, t.startsAt),
  ],
);

export const schedulingStep = pgEnum("scheduling_step", [
  "choose_day",
  "choose_slot",
  "ask_name",
  "confirm_booking",
  "offer_reschedule",
  "confirm_cancel",
  "confirm_reschedule",
  "choose_service",
]);

/** Opção numerada oferecida ao cliente: um dia (YYYY-MM-DD), um horário (ISO) ou um serviço do catálogo. */
export type SessionOption =
  | { n: number; kind: "day"; date: string }
  | { n: number; kind: "slot"; start: string }
  | { n: number; kind: "service"; service: string };

/** Etapa do agendamento em andamento numa conversa (data-model.md). */
export const schedulingSessions = pgTable("scheduling_sessions", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  flow: text("flow").$type<"book" | "cancel" | "reschedule">().notNull(),
  step: schedulingStep("step").notNull(),
  options: jsonb("options").$type<SessionOption[]>().notNull().default([]),
  selectedStart: timestamp("selected_start", { withTimezone: true }),
  customerName: text("customer_name"),
  service: text("service"),
  appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  misunderstoodCount: integer("misunderstood_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Quem pediu para não receber mensagens. Fica pelo telefone, e não pela conversa, para sobreviver à limpeza ao desconectar. */
export const contactPreferences = pgTable("contact_preferences", {
  phone: text("phone").primaryKey(),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Números já conectados neste Secretaryfy; o primeiro uso começa o aquecimento (specs/004, research.md R10). */
export const connectedNumbers = pgTable("connected_numbers", {
  number: text("number").primaryKey(),
  firstConnectedAt: timestamp("first_connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Freio automático dos envios. Uma linha só (specs/004, research.md R11). */
export const protectionState = pgTable(
  "protection_state",
  {
    id: smallint("id").primaryKey().default(1),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    reason: text("reason").$type<"send_failures" | "connection_drops">(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("protection_state_single_row", sql`${t.id} = 1`)],
);

export type ContactPreferenceRow = typeof contactPreferences.$inferSelect;
export type ConnectedNumberRow = typeof connectedNumbers.$inferSelect;
export type ProtectionStateRow = typeof protectionState.$inferSelect;

export type CustomerRow = typeof customers.$inferSelect;

export type CalendarConnectionRow = typeof calendarConnection.$inferSelect;
export type SchedulingRulesRow = typeof schedulingRules.$inferSelect;
export type AppointmentRow = typeof appointments.$inferSelect;
export type ReminderStatus = AppointmentRow["reminderStatus"];
export type SchedulingSessionRow = typeof schedulingSessions.$inferSelect;
export type SchedulingStep = SchedulingSessionRow["step"];

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type MessageOrigin = MessageRow["origin"];
export type MessageType = MessageRow["type"];
export type MessageStatus = MessageRow["status"];
