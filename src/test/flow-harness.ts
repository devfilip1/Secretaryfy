import { after, before, beforeEach } from "node:test";
import { sql } from "drizzle-orm";
import { appointments, customers, messages, type ConversationRow } from "../db/schema.js";
import { createTestDb } from "./db.js";
import { createFakeCalendar, type FakeCalendar } from "./fake-calendar.js";
import { testCatalog } from "./catalog.js";
import { testReplies } from "./clinic.js";
import type { ActiveConnection } from "../modules/google/connection.js";
import { createCustomerRepository, type CustomerRepository } from "../modules/customers/repository.js";
import type { InboxEvent } from "../modules/inbox/events.js";
import { createInboxRepository, type InboxRepository } from "../modules/inbox/repository.js";
import { createInboxService, type InboxService } from "../modules/inbox/service.js";
import { createSchedulingFlow, type SchedulingFlow } from "../modules/scheduling/flow.js";
import type { Interpretation } from "../modules/scheduling/interpret.js";
import type { Replies } from "../modules/scheduling/replies.js";
import { DEFAULT_RULES, type Rules } from "../modules/scheduling/rules.js";
import { createSchedulingStore, type SchedulingStore } from "../modules/scheduling/sessions.js";
import type { SystemNote } from "../modules/inbox/system-note.js";
import { isDeepStrictEqual } from "node:util";

export const tz = "America/Bahia";
// Terça, 20/10/2026, 15:00 em Salvador
export const NOW = new Date("2026-10-20T18:00:00Z");
export const at = (local: string) => new Date(`${local}-03:00`);

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/**
 * Estado e helpers do fluxo de agendamento, compartilhados pelos arquivos de flow/*.test.ts.
 * Chamar no topo de cada arquivo: registra os hooks e devolve `h`.
 * Os testes leem e trocam o estado por `h.<nome>`, porque o beforeEach recria os objetos;
 * por isso só os helpers (funções) e as constantes são desestruturados.
 */
export function useFlowHarness() {
  const h = {
    testDb: undefined as unknown as TestDb,
    repo: undefined as unknown as InboxRepository,
    inbox: undefined as unknown as InboxService,
    store: undefined as unknown as SchedulingStore,
    customerRepo: undefined as unknown as CustomerRepository,
    /** Faz o próximo upsert do cadastro falhar */
    failUpsert: false,
    fake: undefined as unknown as FakeCalendar,
    flow: undefined as unknown as SchedulingFlow,
    events: [] as InboxEvent[],
    conn: null as ActiveConnection | null,
    rules: DEFAULT_RULES as Rules,
    now: NOW,
    /** Tratamento citado na conversa, como o roteador passa (specs/005); null = nenhum */
    mentioned: null as string | null,
    /** Tempo na agenda de tratamentos específicos (ADR 0015); vazio = a duração padrão das regras */
    catalogMinutes: {} as Record<string, number>,
    makeFlow,
    conversation,
    I,
    say,
    sessionOf,
    systemNotes,
    hasNote,
    allAppointments,
    allCustomers,
    book,
    pickSlot,
  };

  before(async () => {
    h.testDb = await createTestDb();
    h.repo = createInboxRepository(h.testDb.db as never);
    h.store = createSchedulingStore(h.testDb.db as never);
    h.customerRepo = createCustomerRepository(h.testDb.db as never);
  });
  after(() => h.testDb.close());

  beforeEach(async () => {
    for (const table of ["scheduling_sessions", "appointments", "customers", "messages", "conversations"]) {
      await h.testDb.db.execute(sql.raw(`delete from ${table}`));
    }
    h.events = [];
    h.now = NOW;
    h.mentioned = "Dental Cleaning";
    h.catalogMinutes = {};
    h.failUpsert = false;
    h.rules = { ...DEFAULT_RULES };
    h.conn = { refreshToken: "t", calendarId: "primary", timeZone: tz, status: "connected" };
    h.inbox = createInboxService({ repo: h.repo, publish: (e) => h.events.push(e), now: () => h.now.getTime() });
    h.fake = createFakeCalendar();
    h.flow = makeFlow(testReplies);
  });

  /** O fluxo com os textos dados: o teste em português troca só eles. */
  function makeFlow(replies: Replies): SchedulingFlow {
    return createSchedulingFlow({
      calendar: h.fake.gateway,
      connection: { getForUse: async () => h.conn },
      rules: { get: async () => h.rules },
      store: h.store,
      inbox: h.inbox,
      customers: {
        upsert: async (v) => {
          if (h.failUpsert) throw new Error("banco fora do ar");
          return h.customerRepo.upsert(v);
        },
      },
      log: { error: () => {} },
      now: () => h.now,
      replies,
      catalog: { ...testCatalog, minutes: (name) => h.catalogMinutes[name] },
    });
  }

  /** Conversa com o nome do perfil "." e, se `name` vier, o nome que o cliente disse (specs/005). */
  async function conversation(phone = "5571999999999", name: string | null = "Maria"): Promise<ConversationRow> {
    const conv = await h.repo.upsertConversation({ phone, name: ".", at: h.now, preview: "Oi" });
    return name ? (await h.repo.setCustomerName(conv.id, name))! : conv;
  }

  function I(intent: Interpretation["intent"], extra: Partial<Interpretation> = {}): Interpretation {
    return {
      intent,
      option: null,
      date: null,
      name: null,
      source: "rule",
      ...extra,
    };
  }

  /** Uma mensagem do cliente já interpretada, com a sessão atual da conversa. */
  async function say(conv: ConversationRow, interpretation: Interpretation) {
    const fresh = (await h.repo.findConversation(conv.id))!;
    // Como o roteador: o nome conhecido é o que o cliente disse
    return h.flow.handle({
      conversation: fresh,
      interpretation,
      session: await h.store.getSession(conv.id, h.now),
      knownName: fresh.customerName,
      mentionedService: h.mentioned,
    });
  }

  function sessionOf(conv: ConversationRow) {
    return h.store.getSession(conv.id, h.now);
  }

  /** Registros do histórico (origin = system), tipados */
  async function systemNotes(conv: ConversationRow): Promise<(SystemNote | null)[]> {
    return (await h.testDb.db.select().from(messages))
      .filter((m) => m.conversationId === conv.id && m.origin === "system")
      .map((m) => m.note);
  }

  /** Há um registro igual a este (tipo e dados), na ordem que tiver */
  function hasNote(notes: (SystemNote | null)[], note: SystemNote) {
    return notes.some((n) => isDeepStrictEqual(n, note));
  }

  function allAppointments() {
    return h.testDb.db.select().from(appointments);
  }

  function allCustomers() {
    return h.testDb.db.select().from(customers);
  }

  /** Marca pela conversa: dia `day` da lista, horário `slot` do dia, e "yes". */
  async function book(conv: ConversationRow, day = 2, slot = 2) {
    await say(conv, I("book"));
    await say(conv, I("choose", { option: day }));
    await say(conv, I("choose", { option: slot }));
    return say(conv, I("yes"));
  }

  /** Pede para marcar e escolhe o dia 2 e o horário 2. */
  async function pickSlot(conv: ConversationRow) {
    await say(conv, I("book"));
    await say(conv, I("choose", { option: 2 }));
    return say(conv, I("choose", { option: 2 }));
  }

  return h;
}
