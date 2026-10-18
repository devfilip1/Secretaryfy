import { and, desc, eq, gte, ilike, isNotNull, ne, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import { conversations, messages, type ConversationRow, type MessageRow } from "../../db/schema.js";

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
        .where(term ? or(ilike(conversations.name, `%${term}%`), ilike(conversations.phone, `%${term}%`)) : undefined)
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
            isNotNull(messages.text),
          ),
        )
        .orderBy(desc(messages.sentAt), desc(messages.createdAt), desc(messages.id))
        .limit(limit);
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
