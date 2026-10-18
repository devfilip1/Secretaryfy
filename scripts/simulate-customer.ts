// Manda ao webhook uma mensagem de cliente, como se viesse do WhatsApp, para testar o assistente sem um segundo número.
// O remetente é o próprio número conectado: a resposta chega no chat "Você" do WhatsApp (specs/003, quickstart.md §3).
// Uso: npx tsx --env-file=.env scripts/simulate-customer.ts "I'd like to book an appointment" [--phone 5571999999999] [--name Maria]
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { phone: { type: "string" }, name: { type: "string", default: "Teste" } },
});
const text = positionals.join(" ").trim();
if (!text) {
  console.error('Uso: npx tsx --env-file=.env scripts/simulate-customer.ts "mensagem" [--phone 55...] [--name Nome]');
  process.exit(2);
}

const { EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE, EVOLUTION_WEBHOOK_TOKEN, PORT = "3000" } = process.env;
if (!EVOLUTION_WEBHOOK_TOKEN) {
  console.error("EVOLUTION_WEBHOOK_TOKEN não definido (rode com --env-file=.env)");
  process.exit(2);
}

/** O número conectado na Evolution API, sem o sufixo do JID. */
async function connectedNumber(): Promise<string> {
  const url = `${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${encodeURIComponent(EVOLUTION_INSTANCE ?? "")}`;
  const res = await fetch(url, { headers: { apikey: EVOLUTION_API_KEY ?? "" } });
  if (!res.ok) throw new Error(`Evolution API ${res.status}`);
  const [instance] = (await res.json()) as { ownerJid?: string }[];
  const number = instance?.ownerJid?.split("@")[0].split(":")[0];
  if (!number) throw new Error("nenhum número conectado na Evolution API; use --phone");
  return number;
}

const phone = values.phone ?? (await connectedNumber());
const body = {
  event: "messages.upsert",
  data: {
    key: { id: `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
    pushName: values.name,
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: text },
  },
};

const res = await fetch(`http://localhost:${PORT}/webhooks/evolution?token=${encodeURIComponent(EVOLUTION_WEBHOOK_TOKEN)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
console.log(`${res.status} ${res.statusText} — "${text}" como cliente ${phone}. A resposta chega no WhatsApp e no painel.`);
