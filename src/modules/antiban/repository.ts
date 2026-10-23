import { and, countDistinct, eq, gte, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import { connectedNumbers, messages, protectionState } from "../../db/schema.js";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Banco da proteção do número: contagens de envio, números conectados e freio (specs/004). */
export function createAntibanRepository(db: Db) {
  return {
    /** Envios já feitos pelo número desde `since`, para semear a janela em memória do portão. */
    async sentTimesSince(since: Date): Promise<Date[]> {
      const rows = await db
        .select({ sentAt: messages.sentAt })
        .from(messages)
        .where(
          and(inArray(messages.origin, ["assistant", "operator"]), eq(messages.status, "sent"), gte(messages.sentAt, since)),
        );
      return rows.map((r) => r.sentAt);
    },

    /** Conversas diferentes respondidas pelo assistente desde `since`. */
    async countConversationsServedSince(since: Date): Promise<number> {
      const [row] = await db
        .select({ n: countDistinct(messages.conversationId) })
        .from(messages)
        .where(and(eq(messages.origin, "assistant"), eq(messages.status, "sent"), gte(messages.sentAt, since)));
      return row?.n ?? 0;
    },

    async servedConversationSince(conversationId: string, since: Date): Promise<boolean> {
      const [row] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.origin, "assistant"),
            eq(messages.status, "sent"),
            gte(messages.sentAt, since),
          ),
        )
        .limit(1);
      return Boolean(row);
    },

    /** Registra a conexão do número; devolve a linha e se ele é novo neste Secretaryfy. */
    async rememberConnectedNumber(number: string, at: Date) {
      const [row] = await db
        .insert(connectedNumbers)
        .values({ number, firstConnectedAt: at, lastConnectedAt: at })
        .onConflictDoUpdate({ target: connectedNumbers.number, set: { lastConnectedAt: at } })
        .returning();
      return { row, isNew: row.firstConnectedAt.getTime() === at.getTime() };
    },

    async getConnectedNumber(number: string) {
      const [row] = await db.select().from(connectedNumbers).where(eq(connectedNumbers.number, number));
      return row ?? null;
    },

    async getProtectionState() {
      const [row] = await db.select().from(protectionState).where(eq(protectionState.id, 1));
      return row ?? null;
    },

    async setPaused(until: Date | null, reason: "send_failures" | "connection_drops" | null) {
      await db
        .insert(protectionState)
        .values({ id: 1, pausedUntil: until, reason, updatedAt: new Date() })
        .onConflictDoUpdate({ target: protectionState.id, set: { pausedUntil: until, reason, updatedAt: new Date() } });
    },

    /** Respostas do assistente que ficaram na fila quando o servidor parou: não são reenviadas (research.md R2). */
    async blockOrphanSending() {
      return db
        .update(messages)
        .set({ status: "blocked", error: "restart" })
        .where(and(eq(messages.origin, "assistant"), eq(messages.status, "sending")))
        .returning();
    },
  };
}

export type AntibanRepository = ReturnType<typeof createAntibanRepository>;
