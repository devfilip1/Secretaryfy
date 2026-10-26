// Mede o agendamento com o modelo real (Ollama) e uma agenda falsa em memória (specs/003, research.md R12).
// Critérios: SC-002 (horários oferecidos dentro da regra), SC-003 (sem duplicidade), SC-004 (nada sem confirmação),
// SC-005 (≥ 90% de acerto do horário) e SC-008 (resposta em até 30 s). Da feature 005: SC-004 (serviço no título do evento).
// Uso: npx tsx --env-file=.env scripts/eval-scheduling.ts [--only "nome do cenário"]
//      AGENT_MODEL=llama3.1:8b npx tsx --env-file=.env scripts/eval-scheduling.ts
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { FastifyBaseLogger } from "fastify";
import { DateTime } from "luxon";
import { createCustomerRepository } from "../src/modules/customers/repository.js";
import { createInboxRepository } from "../src/modules/inbox/repository.js";
import { createInboxService } from "../src/modules/inbox/service.js";
import { slotsForDay } from "../src/modules/scheduling/availability.js";
import { createSchedulingFlow } from "../src/modules/scheduling/flow.js";
import { createInterpreter } from "../src/modules/scheduling/interpret.js";
import { createOllamaClient } from "../src/modules/scheduling/ollama.js";
import { createSchedulingRouter } from "../src/modules/scheduling/router.js";
import { DEFAULT_RULES } from "../src/modules/scheduling/rules.js";
import { createSchedulingStore } from "../src/modules/scheduling/sessions.js";
import { createTestDb } from "../src/test/db.js";
import { createFakeCalendar } from "../src/test/fake-calendar.js";

interface Scenario {
  name: string;
  messages: string[];
  final: string | null;
  busy?: [string, string][];
  existing?: string;
  /** Nome que o cliente já disse na conversa (specs/005); null = ainda não disse */
  whatsappName?: string | null;
  /** Mensagem do cliente antes do roteiro, citando um tratamento; null = nenhuma (specs/005) */
  mention?: string | null;
  /** Título esperado do evento marcado (specs/005 FR-013) */
  summary?: string;
}

const { values } = parseArgs({ options: { only: { type: "string" } } });
const fixture = JSON.parse(readFileSync(new URL("./fixtures/scheduling-scenarios.json", import.meta.url), "utf8")) as {
  now: string;
  timeZone: string;
  scenarios: Scenario[];
};

// Sem DATABASE_URL_TEST, cada cenário roda num Postgres em memória (PGlite)
delete process.env.DATABASE_URL_TEST;

const tz = fixture.timeZone;
const now = DateTime.fromISO(fixture.now).toJSDate();
const local = (iso: string) => DateTime.fromISO(iso, { zone: tz }).toJSDate();
const model = process.env.AGENT_MODEL ?? "llama3";
const ollama = createOllamaClient({
  url: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  model,
  timeoutMs: Number(process.env.AGENT_TIMEOUT_MS ?? 20000),
});
const interpreter = createInterpreter({ ollama });
const silent = { info: () => {}, warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
const rules = DEFAULT_RULES;

const latencies: number[] = [];
let outOfRule = 0;
let duplicates = 0;
let unconfirmed = 0;
let correct = 0;
let summaries = 0;
let summariesOk = 0;

const scenarios = fixture.scenarios.filter((s) => !values.only || s.name === values.only);
console.log(`Modelo: ${model} · ${scenarios.length} cenários · hoje: ${fixture.now} (${tz})\n`);

for (const scenario of scenarios) {
  const testDb = await createTestDb();
  const repo = createInboxRepository(testDb.db as never);
  const inbox = createInboxService({ repo, publish: () => {}, now: () => now.getTime() });
  const store = createSchedulingStore(testDb.db as never);
  const fake = createFakeCalendar({ calendars: [{ id: "primary", name: "DentalSafe", timeZone: tz, primary: true }] });
  for (const [start, end] of scenario.busy ?? []) fake.block(local(start), local(end));

  const phone = "5571999999999";
  const name = scenario.whatsappName === undefined ? "Maria" : scenario.whatsappName;
  const conversation = await repo.upsertConversation({ phone, name: ".", at: now, preview: "" });
  if (name) await repo.setCustomerName(conversation.id, name);
  // Os cenários da feature 003 marcam sem passar pela lista de serviços: o cliente já citou a limpeza
  const mention = scenario.mention === undefined ? "Do you do dental cleaning?" : scenario.mention;
  if (mention) {
    // Pergunta e resposta, como numa conversa de verdade: uma pergunta sem resposta no histórico confunde o modelo
    await inbox.recordIncoming({ kind: "message", id: "E0", phone, fromMe: false, type: "text", text: mention, sentAt: new Date(now.getTime() - 120_000) });
    const out = await inbox.startOutgoing({ conversationId: conversation.id, origin: "assistant", text: "Yes, we do! A dental cleaning takes 30–50 minutes." });
    await inbox.finishOutgoing(out.id, { waId: "OUT0" });
  }

  if (scenario.existing) {
    const start = local(scenario.existing);
    const end = new Date(start.getTime() + rules.slotMinutes * 60_000);
    const id = crypto.randomUUID();
    const { eventId } = await fake.gateway.createEvent({ summary: "Avaliação — Maria", description: "", start, end, timeZone: tz, properties: {} });
    await store.insertBooked({ id, conversationId: conversation.id, phone, origin: "assistant", googleEventId: eventId, calendarId: "primary", startsAt: start, endsAt: end, customerName: "Maria", service: "Dental Cleaning", reminderStatus: "not_needed" });
  }

  const connection = { getForUse: async () => ({ refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" as const }) };
  const customers = createCustomerRepository(testDb.db as never);
  const flow = createSchedulingFlow({ calendar: fake.gateway, connection, rules: { get: async () => rules }, store, inbox, customers, now: () => now });
  const reply = createSchedulingRouter({
    interpreter,
    flow,
    store,
    inbox,
    connection,
    rules: { get: async () => rules },
    answerQuestion: async () => "[resposta do folheto]",
    now: () => now,
  });

  const transcript: string[] = [];
  let seq = 0;
  for (const text of scenario.messages) {
    const before = await store.getSession(conversation.id, now);
    const eventsBefore = fake.calls.createEvent + fake.calls.moveEvent + fake.calls.deleteEvent;

    const message = { kind: "message" as const, id: `E${++seq}`, phone, pushName: name ?? undefined, fromMe: false, type: "text" as const, text, sentAt: new Date(now.getTime() + seq * 1000) };
    await inbox.recordIncoming(message);
    const started = performance.now();
    const answer = await reply({ conversationId: conversation.id, message }, silent);
    latencies.push(performance.now() - started);
    const out = await inbox.startOutgoing({ conversationId: conversation.id, origin: "assistant", text: answer?.text ?? "" });
    await inbox.finishOutgoing(out.id, { waId: `OUT${seq}` });
    transcript.push(`  👤 ${text}`, `  🤖 ${(answer?.text ?? "(sem resposta)").replace(/\n/g, "\n     ")}`);

    // SC-004: agenda alterada só depois de um "sim" numa confirmação
    const changed = fake.calls.createEvent + fake.calls.moveEvent + fake.calls.deleteEvent > eventsBefore;
    if (changed && !before?.step.startsWith("confirm_")) unconfirmed++;

    // SC-002: todo horário oferecido está livre e dentro das regras
    const after = await store.getSession(conversation.id, now);
    const busy = await fake.gateway.busy(now, new Date(now.getTime() + 60 * 86_400_000));
    for (const o of after?.options ?? []) {
      if (o.kind !== "slot") continue;
      const start = new Date(o.start);
      const day = DateTime.fromJSDate(start, { zone: tz }).toISODate()!;
      if (!slotsForDay(day, { rules, busy, now, timeZone: tz }).some((s) => s.getTime() === start.getTime())) outOfRule++;
    }
  }

  // SC-003: nenhum evento sobreposto
  const evs = [...fake.events.values()];
  for (let i = 0; i < evs.length; i++) {
    for (let j = i + 1; j < evs.length; j++) if (evs[i].start < evs[j].end && evs[j].start < evs[i].end) duplicates++;
  }

  const booked = await store.findFutureBooked(phone, now);
  const got = booked ? DateTime.fromJSDate(booked.startsAt, { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm") : null;
  const ok = got === scenario.final;
  if (ok) correct++;
  // specs/005 SC-004: o título do evento traz o nome e o serviço
  let titleOk = true;
  if (scenario.summary) {
    summaries++;
    const title = booked ? [...fake.events.values()].find((e) => e.start.getTime() === booked.startsAt.getTime())?.summary : undefined;
    titleOk = title === scenario.summary;
    if (titleOk) summariesOk++;
    else console.log(`  título esperado "${scenario.summary}", obtido "${title ?? "nenhum"}"`);
  }
  console.log(`${ok ? "✔" : "✖"} ${scenario.name} — esperado ${scenario.final ?? "nenhum"}, obtido ${got ?? "nenhum"}`);
  if (!ok || !titleOk) console.log(transcript.join("\n"));
  await testDb.close();
}

const sorted = [...latencies].sort((a, b) => a - b);
const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
const max = sorted.at(-1) ?? 0;
const accuracy = scenarios.length ? correct / scenarios.length : 0;

const checks: [string, boolean, string][] = [
  ["SC-002 horários oferecidos fora da regra", outOfRule === 0, String(outOfRule)],
  ["SC-003 eventos sobrepostos", duplicates === 0, String(duplicates)],
  ["SC-004 mudanças na agenda sem confirmação", unconfirmed === 0, String(unconfirmed)],
  ["SC-005 acerto do horário (meta ≥ 90%)", accuracy >= 0.9, `${correct}/${scenarios.length} (${Math.round(accuracy * 100)}%)`],
  ["SC-008 latência por resposta (meta ≤ 30 s)", max <= 30_000, `p95 ${(p95 / 1000).toFixed(1)} s · máx ${(max / 1000).toFixed(1)} s`],
  ["005 SC-004 serviço no título do evento (meta ≥ 90%)", summaries === 0 || summariesOk / summaries >= 0.9, `${summariesOk}/${summaries}`],
];
console.log("\nResumo");
for (const [label, pass, value] of checks) console.log(`${pass ? "✔" : "✖"} ${label}: ${value}`);
process.exit(checks.every(([, pass]) => pass) ? 0 : 1);
