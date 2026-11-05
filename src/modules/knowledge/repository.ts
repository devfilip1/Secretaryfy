import { asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import { knowledgeSections } from "../../db/schema.js";
import { knowledgeRowSchema, type KnowledgeRow } from "./types.js";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A lista de ordem não bate com as seções guardadas (chave desconhecida, faltando ou repetida). */
export class KnowledgeOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeOrderError";
  }
}

/** Acesso à tabela knowledge_sections. Cada linha passa pelo zod ao entrar e ao sair (a coluna jsonb não é checada pelo banco). */
export function createKnowledgeRepository(db: Db) {
  return {
    /** Seções na ordem de exibição. */
    async list(): Promise<KnowledgeRow[]> {
      const rows = await db.select().from(knowledgeSections).orderBy(asc(knowledgeSections.position));
      return rows.map((row) => knowledgeRowSchema.parse(row));
    },

    /** Uma seção pela chave, ou null. */
    async get(key: string): Promise<KnowledgeRow | null> {
      const [row] = await db.select().from(knowledgeSections).where(eq(knowledgeSections.key, key));
      return row ? knowledgeRowSchema.parse(row) : null;
    },

    /** Cria a seção ou troca a que já tem essa chave (o painel mantém a chave). */
    async upsert(row: KnowledgeRow): Promise<void> {
      const valid = knowledgeRowSchema.parse(row);
      await db
        .insert(knowledgeSections)
        .values(valid)
        .onConflictDoUpdate({
          target: knowledgeSections.key,
          set: {
            kind: valid.kind,
            title: valid.title,
            tagline: valid.tagline,
            data: valid.data,
            position: valid.position,
            updatedAt: new Date(),
          },
        });
    },

    /** Apaga a seção pela chave; devolve false quando ela não existia. */
    async remove(key: string): Promise<boolean> {
      const removed = await db.delete(knowledgeSections).where(eq(knowledgeSections.key, key)).returning({ id: knowledgeSections.id });
      return removed.length > 0;
    },

    /** Grava `position` na ordem das chaves, numa transação. A lista tem de ter exatamente as seções guardadas. */
    async reorder(keys: string[]): Promise<void> {
      await db.transaction(async (tx) => {
        const stored = new Set((await tx.select({ key: knowledgeSections.key }).from(knowledgeSections)).map((row) => row.key));
        const unknown = keys.filter((key) => !stored.has(key));
        const missing = [...stored].filter((key) => !keys.includes(key));
        const repeated = keys.length !== new Set(keys).size;
        if (unknown.length > 0 || missing.length > 0 || repeated) {
          throw new KnowledgeOrderError(
            `keys must list every section once (unknown: ${unknown.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}; repeated: ${repeated})`,
          );
        }
        for (const [position, key] of keys.entries()) {
          await tx.update(knowledgeSections).set({ position }).where(eq(knowledgeSections.key, key));
        }
      });
    },

    /** Troca o conteúdo inteiro numa transação; importar o mesmo arquivo duas vezes dá o mesmo resultado. */
    async replaceAll(rows: KnowledgeRow[]): Promise<void> {
      const valid = rows.map((row) => knowledgeRowSchema.parse(row));
      await db.transaction(async (tx) => {
        await tx.delete(knowledgeSections);
        if (valid.length > 0) await tx.insert(knowledgeSections).values(valid);
      });
    },
  };
}

export type KnowledgeRepository = ReturnType<typeof createKnowledgeRepository>;
