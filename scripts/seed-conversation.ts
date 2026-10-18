// Popula uma conversa com muitas mensagens, para medir a abertura do painel (SC-006).
// Uso: node --env-file=.env --import tsx scripts/seed-conversation.ts [telefone] [quantidade=500]
import { eq } from "drizzle-orm";
import { db, sql as raw } from "../src/db/client.js";
import { conversations, messages } from "../src/db/schema.js";

const phone = process.argv[2] ?? "5511900000000";
const count = Number(process.argv[3] ?? 500);
const start = Date.now() - count * 60_000;

const [conversation] = await db
  .insert(conversations)
  .values({ phone, name: "Seed", lastMessageAt: new Date(start), lastMessagePreview: "" })
  .onConflictDoUpdate({ target: conversations.phone, set: { name: "Seed" } })
  .returning();

const rows = Array.from({ length: count }, (_, i) => {
  const customer = i % 2 === 0;
  return {
    conversationId: conversation.id,
    waMessageId: `seed-${phone}-${i + 1}`,
    origin: customer ? ("customer" as const) : ("assistant" as const),
    type: "text" as const,
    text: customer ? `Pergunta de teste nº ${i + 1}` : `Resposta de teste nº ${i + 1}`,
    status: customer ? ("received" as const) : ("sent" as const),
    sentAt: new Date(start + i * 60_000),
  };
});

for (let i = 0; i < rows.length; i += 200) {
  await db.insert(messages).values(rows.slice(i, i + 200)).onConflictDoNothing({ target: messages.waMessageId });
}
const last = rows.at(-1)!;
await db
  .update(conversations)
  .set({ lastMessageAt: last.sentAt, lastMessagePreview: last.text })
  .where(eq(conversations.id, conversation.id));

console.log(`conversa ${conversation.id} (${phone}) com ${count} mensagens`);
await raw.end();
