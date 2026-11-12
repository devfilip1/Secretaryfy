import type { SystemNote } from "../modules/inbox/system-note.js";
import type { FastifyBaseLogger } from "fastify";
import type { AppointmentRow, ConversationRow, SchedulingSessionRow } from "../db/schema.js";
import type { IncomingMessage } from "../modules/whatsapp/evolution.js";
import { testReplies as replies } from "./clinic.js";
import type { SchedulingFlow } from "../modules/scheduling/flow.js";
import type { Replies } from "../modules/scheduling/replies.js";
import type { DayPeriod, Interpretation, InterpretInput, Interpreter } from "../modules/scheduling/interpret.js";
import type { Agreement } from "../modules/scheduling/understanding/agreement.js";
import { InterpreterUnavailable } from "../modules/scheduling/ollama.js";
import { createSchedulingRouter } from "../modules/scheduling/router.js";
import { DEFAULT_RULES } from "../modules/scheduling/rules.js";

const log = { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
export const MESSAGE: IncomingMessage = {
  kind: "message",
  id: "M1",
  phone: "5571999999999",
  fromMe: false,
  type: "text",
  text: "How much are braces?",
  sentAt: new Date(),
};
export const SESSION = { conversationId: "c1", step: "choose_day", options: [{ n: 1, kind: "day", date: "2026-10-21" }] } as SchedulingSessionRow;

export function setup({
  intent,
  session = null,
  unavailable = false,
  customerName = "Maria",
  registryName = null,
  nameAskedAt = null,
  messagesSinceAsk = 1,
  nameAsks = 0,
  name = null,
  urgent,
  reminded = null,
  messagesSinceReminder = 1,
  humanize,
  firstMessage = false,
  assistantSaid,
  brochureAnswer,
  text = MESSAGE.text!,
  history,
  service = null,
  mentioned = null,
  time = null,
  date = null,
  when = null,
  pick = null,
  sense = null,
  topicOnly = false,
  agreement = null,
  flowReply = "do agendamento",
  texts = replies,
}: {  intent?: Interpretation["intent"];
  /** Os textos do roteador (o padrão são os de teste; um catálogo com outros serviços pede os seus) */
  texts?: Replies;
  /** O que o fluxo responde (o padrão é "do agendamento") */
  flowReply?: string;
  /** Serviço que o modelo deu junto da intenção (o tratamento de que a conversa fala) */
  service?: string | null;
  /** Tratamento que o interpretador acha que a conversa cita (mentionedService), sem a interpretação trazer um */
  mentioned?: string | null;
  session?: SchedulingSessionRow | null;
  unavailable?: boolean;
  /** Nome dito na conversa; null = o cliente ainda não disse */
  customerName?: string | null;
  /** Nome do cadastro de clientes */
  registryName?: string | null;
  nameAskedAt?: Date | null;
  /** Quantos pedidos de nome já fizemos */
  nameAsks?: number;
  /** Histórico que o cliente viu, com as mensagens desde a nossa última resposta (padrão: uma conversa com resposta nossa) */
  history?: { role: "user" | "assistant"; content: string }[];
  messagesSinceAsk?: number;
  /** Nome que o interpretador devolve junto da intenção */
  name?: string | null;
  /** needs_staff com urgência de saúde */
  urgent?: boolean;
  /** Horário cujo lembrete saiu e espera a resposta (specs/006) */
  reminded?: AppointmentRow | null;
  messagesSinceReminder?: number;
  /** Horário que o interpretador devolve junto da intenção */
  time?: string | null;
  /** Data que o interpretador devolve junto da intenção (o modelo às vezes a inventa) */
  date?: string | null;
  /** O que a chamada focada mentionedWhen acha (horário ou parte do dia); o padrão é nada */
  when?: { time: string | null; period: DayPeriod | null; namesDay?: boolean | null } | null;
  /** Opção que a chamada focada acha na mensagem (mentionedOption) */
  pick?: number | null;
  /** Palavras sem sentido: a chamada de sentido (mentionedSense) acha que a mensagem não tem sentido; o padrão é não */
  sense?: boolean | null;
  /** A intenção é só o assunto da pergunta de sim ou não (topicOnly na interpretação, ver validate.ts) */
  topicOnly?: boolean;
  /** Concordância que a chamada focada mentionedAgreement acha; null = a chamada falhou ou não se decide */
  agreement?: Agreement | null;
  humanize?: (reply: string) => Promise<string>;
  /** A conversa ainda não tem resposta nossa */
  firstMessage?: boolean;
  /** Texto que o assistente já mandou nesta conversa */
  assistantSaid?: string;
  /** O que o RAG responde; o padrão é "do folheto" */
  brochureAnswer?: string;
  /** O que o cliente escreveu */
  text?: string;
}) {
  const inputs: InterpretInput[] = [];
  const handled: { interpretation: Interpretation; knownName: string | null; mentionedService: string | null }[] = [];
  const asked: string[] = [];
  const mentionCalls: Parameters<Interpreter["mentionedService"]>[0][] = [];
  const whenCalls: Parameters<Interpreter["mentionedWhen"]>[0][] = [];
  const histories: unknown[] = [];
  const savedNames: string[] = [];
  const askedAt: Date[] = [];
  const confirmed: string[] = [];
  const notes: SystemNote[] = [];
  const flagged: string[] = [];
  const cleared: string[] = [];
  const conversation = { id: "c1", phone: MESSAGE.phone, name: ".", customerName, nameAskedAt, nameAsks } as ConversationRow;
  const interpreter: Interpreter = {
    interpret: async (input) => {
      inputs.push(input);
      if (unavailable) throw new InterpreterUnavailable("Ollama fora do ar");
      return { intent: intent!, option: null, date, name, urgent, service, source: "model", ...(time ? { time } : {}), ...(topicOnly ? { topicOnly: true } : {}) };
    },
    mentionedWhen: async (input) => {
      whenCalls.push(input);
      return when ?? { time: null, period: null };
    },
    mentionedOption: async () => pick,
    mentionedSense: async () => sense,
    mentionedAgreement: async () => agreement,
    mentionedService: async (input) => {
      mentionCalls.push(input);
      return mentioned;
    },
  };
  const flow = {
    handle: async (input: { interpretation: Interpretation; knownName: string | null; mentionedService: string | null }) => {
      const { interpretation } = input;
      handled.push(input);
      return interpretation.intent === "unclear" ? { reply: "handoff", handoff: true } : { reply: flowReply };
    },
  } as unknown as SchedulingFlow;

  const seenHistory: { role: "user" | "assistant"; content: string }[] =
    history ??
    (firstMessage
      ? [{ role: "user", content: text }]
      : [
          { role: "user", content: "hi" },
          { role: "assistant", content: assistantSaid ?? "Hello!" },
          { role: "user", content: text },
        ]);
  const reply = createSchedulingRouter({
    interpreter,
    flow,
    replies: texts,
    store: {
      getSession: async () => session,
      clearSession: async (id) => {
        cleared.push(id);
      },
      findReminderAwaiting: async () => reminded,
      confirm: async (id) => {
        confirmed.push(id);
        return null;
      },
    },
    inbox: {
      getConversation: async () => conversation,
      flagNeedsAttention: async (id) => {
        flagged.push(id);
        return null as never;
      },
      knownName: async (c) => c.customerName ?? registryName,
      setCustomerName: async (_id, n) => {
        savedNames.push(n);
        return null;
      },
      markNameAsked: async (_id, at) => {
        askedAt.push(at);
      },
      customerMessagesSince: async (_id, since) => (since === reminded?.reminderSentAt ? messagesSinceReminder : messagesSinceAsk),
      recordSystem: async (_id, note) => {
        notes.push(note);
        return null as never;
      },
      recentHistory: async () => seenHistory,
    },
    connection: { getForUse: async () => ({ refreshToken: "t", calendarId: "primary", timeZone: "America/Bahia", status: "connected" }) },
    rules: { get: async () => DEFAULT_RULES },
    answerQuestion: async (q, _log, _phone, history) => {
      histories.push(history);
      asked.push(q);
      return brochureAnswer ?? "do folheto";
    },
    humanize,
  });
  return { reply: () => reply({ conversationId: "c1", message: { ...MESSAGE, text } }, log), inputs, handled, asked, histories, mentionCalls, whenCalls, savedNames, askedAt, confirmed, notes, flagged, cleared };
}
