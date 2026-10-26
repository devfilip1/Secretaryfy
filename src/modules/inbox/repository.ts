import { and, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import { contactPreferences, conversations, messages, type ConversationRow, type MessageRow } from "../../db/schema.js";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type NewMessage = typeof messages.$inferInsert;

/** Consultas das conversas e mensagens sobre `db`, que pode ser o cliente normal ou uma transação. */
function createQueries(db: Db) {
  const repo = {
    /** Cria a conversa do número, ou atualiza o nome se vier preenchido. */
    async upsertConversation(v: { phone: string; name: string | null; at: Date; preview: string }) {
      const [row] = await db
        .insert(conversations)
        .values({ phone: v.phone, name: v.name, lastMessageAt: v.at, lastMessagePreview: v.preview })
        .onConflictDoUpdate({
          target: conversations.phone,
          set: { name: sql`coalesce(excluded.name, ${conversations.name})` },
        })
        .returning();
      return row;
    },

    /** Nome que o cliente disse na conversa (specs/005 FR-003); substitui o anterior. */
    async setCustomerName(conversationId: string, name: string): Promise<ConversationRow | null> {
      const [row] = await db.update(conversations).set({ customerName: name }).where(eq(conversations.id, conversationId)).returning();
      return row ?? null;
    },

    /** A conversa de um telefone (o telefone é único entre as conversas); horários e clientes a acham por ele. */
    async findConversationByPhone(phone: string): Promise<ConversationRow | null> {
      const [row] = await db.select().from(conversations).where(eq(conversations.phone, phone));
      return row ?? null;
    },

    /** Telefone → id da conversa, para listas do painel (specs/006). */
    async conversationIdsByPhone(phones: string[]): Promise<Map<string, string>> {
      if (phones.length === 0) return new Map();
      const rows = await db
        .select({ id: conversations.id, phone: conversations.phone })
        .from(conversations)
        .where(inArray(conversations.phone, [...new Set(phones)]));
      return new Map(rows.map((r) => [r.phone, r.id]));
    },

    /** Nome editado no cadastro (specs/006 FR-007): vale para a conversa do telefone, se houver. */
    async setCustomerNameByPhone(phone: string, name: string): Promise<ConversationRow | null> {
      const [row] = await db.update(conversations).set({ customerName: name }).where(eq(conversations.phone, phone)).returning();
      return row ?? null;
    },

    /** Cadastro excluído no painel: a conversa do número esquece o nome e o pedido de nome volta a valer. */
    async forgetCustomerName(phone: string): Promise<ConversationRow | null> {
      const [row] = await db
        .update(conversations)
        .set({ customerName: null, nameAskedAt: null })
        .where(eq(conversations.phone, phone))
        .returning();
      return row ?? null;
    },

    /** Registra o pedido de nome uma vez só (FR-005). */
    async markNameAsked(conversationId: string, at: Date): Promise<void> {
      await db
        .update(conversations)
        .set({ nameAskedAt: at })
        .where(and(eq(conversations.id, conversationId), isNull(conversations.nameAskedAt)));
    },

    /** Mensagens do cliente depois de `since`. */
    async customerMessagesSince(conversationId: string, since: Date): Promise<number> {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.origin, "customer"), gt(messages.sentAt, since)));
      return row.n;
    },

    async findConversation(id: string): Promise<ConversationRow | null> {
      const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
      return row ?? null;
    },

    /** Insere a mensagem; devolve null se o wa_message_id já existir. */
    async insertMessage(values: NewMessage): Promise<MessageRow | null> {
      const [row] = await db
        .insert(messages)
        .values(values)
        .onConflictDoNothing({ target: messages.waMessageId })
        .returning();
      return row ?? null;
    },

    async updateMessage(id: string, patch: Partial<NewMessage>): Promise<MessageRow | null> {
      const [row] = await db.update(messages).set(patch).where(eq(messages.id, id)).returning();
      return row ?? null;
    },

    async deleteMessage(id: string): Promise<void> {
      await db.delete(messages).where(eq(messages.id, id));
    },

    async findMessage(id: string): Promise<MessageRow | null> {
      const [row] = await db.select().from(messages).where(eq(messages.id, id));
      return row ?? null;
    },

    async findMessageByWaId(waId: string): Promise<MessageRow | null> {
      const [row] = await db.select().from(messages).where(eq(messages.waMessageId, waId));
      return row ?? null;
    },

    /** Envio do sistema ainda sem id do WhatsApp, com o mesmo texto, criado depois de `since`. */
    async findPendingEcho(conversationId: string, text: string, since: Date): Promise<MessageRow | null> {
      const [row] = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.status, "sending"),
            eq(messages.text, text),
            gte(messages.createdAt, since),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(1);
      return row ?? null;
    },

    /** Atualiza a prévia (só se a mensagem for a mais recente) e, se pedido, soma uma não lida. */
    async touchConversation(id: string, v: { lastMessageAt: Date; preview: string; incrementUnread: boolean }) {
      const at = v.lastMessageAt.toISOString();
      const [row] = await db
        .update(conversations)
        .set({
          lastMessagePreview: sql`case when ${at}::timestamptz >= ${conversations.lastMessageAt} then ${v.preview} else ${conversations.lastMessagePreview} end`,
          lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${at}::timestamptz)`,
          ...(v.incrementUnread ? { unreadCount: sql`${conversations.unreadCount} + 1` } : {}),
        })
        .where(eq(conversations.id, id))
        .returning();
      return row;
    },

    async listConversations({ q, limit = 100 }: { q?: string; limit?: number } = {}) {
      const term = q?.trim();
      return db
        .select()
        .from(conversations)
        .where(
          term
            ? or(
                ilike(conversations.customerName, `%${term}%`),
                ilike(conversations.name, `%${term}%`),
                ilike(conversations.phone, `%${term}%`),
              )
            : undefined,
        )
        .orderBy(desc(conversations.lastMessageAt))
        .limit(limit);
    },

    /** Página de mensagens anteriores a `before`, em ordem cronológica. */
    async listMessages(conversationId: string, { before, limit = 50 }: { before?: string; limit?: number } = {}) {
      let cursor: MessageRow | null = null;
      if (before) {
        cursor = await repo.findMessage(before);
        if (!cursor || cursor.conversationId !== conversationId) return { messages: [], hasMore: false };
      }
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            cursor
              ? sql`(${messages.sentAt}, ${messages.createdAt}, ${messages.id}) < (${cursor.sentAt.toISOString()}::timestamptz, ${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(messages.sentAt), desc(messages.createdAt), desc(messages.id))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      return { messages: rows.slice(0, limit).reverse(), hasMore };
    },

    /** Apaga todas as conversas; mensagens, agendamentos e sessões de agendamento vão junto pelo cascade. */
    async deleteAllConversations(): Promise<number> {
      const rows = await db.delete(conversations).returning({ id: conversations.id });
      return rows.length;
    },

    /** Reativar o assistente também tira o destaque de "precisa de atendimento" (FR-024b). */
    async setPaused(id: string, paused: boolean): Promise<ConversationRow | null> {
      const [row] = await db
        .update(conversations)
        .set(paused ? { assistantPaused: true } : { assistantPaused: false, needsAttention: false })
        .where(eq(conversations.id, id))
        .returning();
      return row ?? null;
    },

    async markRead(id: string): Promise<ConversationRow | null> {
      const [row] = await db
        .update(conversations)
        .set({ unreadCount: 0, needsAttention: false })
        .where(eq(conversations.id, id))
        .returning();
      return row ?? null;
    },

    /** O assistente desistiu: pausa e destaca a conversa para o operador (FR-024a). */
    async flagNeedsAttention(id: string): Promise<ConversationRow | null> {
      const [row] = await db
        .update(conversations)
        .set({ assistantPaused: true, needsAttention: true })
        .where(eq(conversations.id, id))
        .returning();
      return row ?? null;
    },

    /** Últimas mensagens de texto da conversa, sem os registros do sistema, da mais recente para a mais antiga. */
    async recentTexts(conversationId: string, limit: number) {
      return db
        .select({ origin: messages.origin, text: messages.text })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.type, "text"),
            ne(messages.origin, "system"),
            ne(messages.status, "blocked"),
            isNotNull(messages.text),
          ),
        )
        .orderBy(desc(messages.sentAt), desc(messages.createdAt), desc(messages.id))
        .limit(limit);
    },

    // --- Proteção do número (specs/004) ---

    async isOptedOut(phone: string): Promise<boolean> {
      const [row] = await db
        .select({ at: contactPreferences.optedOutAt })
        .from(contactPreferences)
        .where(eq(contactPreferences.phone, phone));
      return Boolean(row?.at);
    },

    /** Telefones da lista que pediram para não receber mensagens. */
    async optedOutAmong(phones: string[]): Promise<Set<string>> {
      if (!phones.length) return new Set();
      const rows = await db
        .select({ phone: contactPreferences.phone })
        .from(contactPreferences)
        .where(and(inArray(contactPreferences.phone, phones), isNotNull(contactPreferences.optedOutAt)));
      return new Set(rows.map((r) => r.phone));
    },

    /** `at` preenchido: o cliente pediu para sair; null: voltou a aceitar mensagens. Fica pelo telefone. */
    async setOptedOut(phone: string, at: Date | null) {
      await db
        .insert(contactPreferences)
        .values({ phone, optedOutAt: at, updatedAt: new Date() })
        .onConflictDoUpdate({ target: contactPreferences.phone, set: { optedOutAt: at, updatedAt: new Date() } });
    },

    async lastCustomerMessageAt(conversationId: string): Promise<Date | null> {
      const [row] = await db
        .select({ at: sql<Date | null>`max(${messages.sentAt})`.mapWith((v) => (v ? new Date(v) : null)) })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.origin, "customer")));
      return row?.at ?? null;
    },

    /** Mensagens do cliente depois da última resposta enviada (assistente ou operador), em ordem cronológica. */
    async customerMessagesSinceLastReply(conversationId: string) {
      const lastReply = db
        .select({ at: sql`max(${messages.sentAt})` })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            inArray(messages.origin, ["assistant", "operator"]),
            eq(messages.status, "sent"),
          ),
        );
      return db
        .select({ id: messages.id, waMessageId: messages.waMessageId, type: messages.type, text: messages.text, sentAt: messages.sentAt })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.origin, "customer"),
            sql`${messages.sentAt} > coalesce((${lastReply}), '-infinity'::timestamptz)`,
          ),
        )
        .orderBy(messages.sentAt, messages.createdAt);
    },

    /** Últimas mensagens para avaliar laço e insistência, em ordem cronológica, sem registros do sistema e bloqueios. */
    async recentForAssessment(conversationId: string, limit = 30) {
      const rows = await db
        .select({ origin: messages.origin, status: messages.status, sentAt: messages.sentAt })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), ne(messages.origin, "system"), ne(messages.status, "blocked")))
        .orderBy(desc(messages.sentAt), desc(messages.createdAt), desc(messages.id))
        .limit(limit);
      return rows.reverse();
    },

    /** Textos que o assistente mandou (ou está mandando) na conversa desde `since`. */
    async assistantTextsSince(conversationId: string, since: Date): Promise<string[]> {
      const rows = await db
        .select({ text: messages.text })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.origin, "assistant"),
            inArray(messages.status, ["sending", "sent"]),
            gte(messages.sentAt, since),
          ),
        );
      return rows.map((r) => r.text ?? "");
    },

    async hasAssistantReply(conversationId: string): Promise<boolean> {
      const [row] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.origin, "assistant"), eq(messages.status, "sent")))
        .limit(1);
      return Boolean(row);
    },

    /** O operador escreveu na conversa depois de `since`? */
    async operatorWroteSince(conversationId: string, since: Date): Promise<boolean> {
      const [row] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.origin, "operator"), gt(messages.createdAt, since)))
        .limit(1);
      return Boolean(row);
    },
  };
  return repo;
}

export type InboxQueries = ReturnType<typeof createQueries>;

/** Acesso ao banco das conversas e mensagens. */
export function createInboxRepository(db: Db) {
  return {
    ...createQueries(db),
    transaction<T>(fn: (tx: InboxQueries) => Promise<T>): Promise<T> {
      return db.transaction((tx) => fn(createQueries(tx as unknown as Db)));
    },
  };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;
