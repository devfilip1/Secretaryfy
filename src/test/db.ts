// Banco para os testes do inbox, com as migrations aplicadas.
// Com DATABASE_URL_TEST usa esse Postgres (as tabelas do inbox são esvaziadas); sem ela, um Postgres em memória (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../db/schema.js";

const migrationsFolder = "drizzle";

export async function createTestDb() {
  const url = process.env.DATABASE_URL_TEST;
  if (url) {
    const client = postgres(url, { onnotice: () => {} });
    const db = drizzlePostgres(client, { schema });
    await migratePostgres(db, { migrationsFolder });
    await db.execute(sql`truncate table scheduling_sessions, appointments, customers, messages, conversations, calendar_connection, scheduling_rules cascade`);
    return { db, close: () => client.end() };
  }
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
