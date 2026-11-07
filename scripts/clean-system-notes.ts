// Limpeza única das notas do sistema (origin = system): tira o emoji do início e troca " — " por ", ".
// Idempotente: uma nota já limpa não muda. Uso: npx tsx --env-file=.env scripts/clean-system-notes.ts
import { eq } from "drizzle-orm";
import { sql, db } from "../src/db/client.js";
import { messages } from "../src/db/schema.js";

const LEADING_EMOJI = /^(?:\p{Extended_Pictographic}️?\s*)+/u;

const rows = await db
  .select({ id: messages.id, text: messages.text })
  .from(messages)
  .where(eq(messages.origin, "system"));

let cleaned = 0;
for (const row of rows) {
  if (row.text === null) continue;
  const next = row.text.replace(LEADING_EMOJI, "").replaceAll(" — ", ", ");
  if (next === row.text) continue;
  await db.update(messages).set({ text: next }).where(eq(messages.id, row.id));
  cleaned++;
}

console.log(`${cleaned} notas do sistema limpas (de ${rows.length} notas do sistema)`);
await sql.end();
