import type { FastifyBaseLogger } from "fastify";
import type { ConnectionStore } from "../google/connection.js";
import type { InboxService } from "../inbox/service.js";
import type { ConversationTurn } from "../rag/client.js";
import type { IncomingMessage } from "../whatsapp/evolution.js";
import type { Reply } from "../whatsapp/handle-message.js";
import { bookingWindow } from "./availability.js";
import type { SchedulingFlow } from "./flow.js";
import type { Intent, Interpreter } from "./interpret.js";
import { InterpreterUnavailable } from "./ollama.js";
import { replies, systemNotes } from "./replies.js";
import type { RulesStore } from "./rules.js";
import { detectService } from "./services.js";
import type { SchedulingStore } from "./sessions.js";

/** Intenções que começam um fluxo quando não há etapa em andamento (research.md R3). */
const STARTERS: Intent[] = ["book", "availability", "cancel", "reschedule", "my_appointment"];

interface Deps {
  interpreter: Interpreter;
  flow: SchedulingFlow;
  store: Pick<SchedulingStore, "getSession" | "findReminderAwaiting" | "confirm">;
  inbox: Pick<
    InboxService,
    "getConversation" | "recentHistory" | "knownName" | "setCustomerName" | "markNameAsked" | "customerMessagesSince" | "recordSystem"
  >;
  connection: Pick<ConnectionStore, "getForUse">;
  rules: Pick<RulesStore, "get">;
  /**
   * Resposta do folheto (RAG da feature 001), já com a mensagem de indisponibilidade em caso de falha. O histórico
   * resolve perguntas que dependem da anterior ("how much does it cost?" depois de perguntar da limpeza).
   */
  answerQuestion: (question: string, log: FastifyBaseLogger, phone: string, history?: ConversationTurn[]) => Promise<string>;
  now?: () => Date;
}

/** Decide se a mensagem vai para o agendamento ou para o folheto, e devolve o texto da resposta. */
export function createSchedulingRouter({ interpreter, flow, store, inbox, connection, rules, answerQuestion, now = () => new Date() }: Deps) {
  return async function reply(
    { conversationId, message }: { conversationId: string; message: IncomingMessage },
    log: FastifyBaseLogger,
  ): Promise<Reply | null> {
    const text = message.text ?? "";
    const conversation = await inbox.getConversation(conversationId);
    if (!conversation) return null;

    const at = now();
    const session = await store.getSession(conversationId, at);
    const conn = await connection.getForUse();
    const timeZone = conn?.timeZone ?? "UTC";
    const window = bookingWindow({ rules: await rules.get(), now: at, timeZone });

    // O histórico já inclui a mensagem atual, que vai separada para o modelo
    const history = await inbox.recentHistory(conversationId);
    const last = history.at(-1);
    if (last?.role === "user" && last.content === text) history.pop();

    // Nome do cliente (specs/005, research.md R1 a R3): quem está no cadastro já é conhecido numa conversa nova
    let known = await inbox.knownName(conversation);
    if (known && !conversation.customerName) await inbox.setCustomerName(conversationId, known);
    // Só a primeira mensagem depois do pedido pode ser o nome sozinho (a atual já está gravada)
    const awaitingName =
      !known && conversation.nameAskedAt !== null && (await inbox.customerMessagesSince(conversationId, conversation.nameAskedAt)) <= 1;

    // Resposta ao lembrete (specs/006 R5): sem agendamento em andamento, o lembrete saiu e o cliente mal respondeu desde então
    const reminded = session ? null : await store.findReminderAwaiting(conversation.phone, at);
    const awaitingReminder = Boolean(
      reminded?.reminderSentAt && (await inbox.customerMessagesSince(conversationId, reminded.reminderSentAt)) <= 1,
    );

    /** Resposta do folheto; para quem ainda não disse o nome, o pedido vai junto, uma única vez (FR-001, FR-002, FR-005). */
    async function fromBrochure(): Promise<Reply> {
      const reply: Reply = { text: await answerQuestion(text, log, message.phone, history), split: true };
      if (known || conversation!.nameAskedAt) return reply;
      await inbox.markNameAsked(conversationId, at);
      return { ...reply, followUp: replies.askNameFollowUp() };
    }

    const started = Date.now();
    let interpretation;
    try {
      interpretation = await interpreter.interpret({
        text,
        step: session?.step ?? null,
        options: session?.options ?? [],
        history,
        now: at,
        timeZone,
        window,
        awaitingName,
        awaitingReminder,
      });
    } catch (err) {
      if (!(err instanceof InterpreterUnavailable)) throw err;
      log.error({ phone: message.phone, err: err.message }, "interpretador indisponível");
      // Sem fluxo em andamento, a mensagem segue para o folheto como na feature 001
      if (session) return { text: replies.interpreterUnavailable() };
      return fromBrochure();
    }

    log.info(
      { phone: message.phone, intent: interpretation.intent, source: interpretation.source, step: session?.step ?? null, latency_ms: Date.now() - started },
      "mensagem interpretada",
    );

    // Despedida: sem agendamento em andamento, só se despede; no meio de um, encerra o agendamento
    if (interpretation.intent === "goodbye") {
      if (!session) return { text: replies.goodbye() };
      interpretation = { ...interpretation, intent: "stop" as const };
    }

    if (awaitingReminder && reminded) {
      // YES confirma o horário; NO leva à pergunta de remarcação, que já existe (o "book" com horário marcado)
      if (interpretation.intent === "yes") {
        await store.confirm(reminded.id, "customer", at);
        await inbox.recordSystem(conversationId, systemNotes.confirmedByCustomer(reminded.startsAt, timeZone));
        return { text: replies.reminderConfirmed(reminded.startsAt, known, timeZone) };
      }
      if (interpretation.intent === "no") interpretation = { ...interpretation, intent: "book" as const };
    }

    // O nome dito fica na conversa; na etapa ask_name quem grava é o fluxo, junto com o resumo
    const { name } = interpretation;
    if (name && (interpretation.intent === "give_name" || awaitingName) && session?.step !== "ask_name") {
      await inbox.setCustomerName(conversationId, name);
      known = name;
      if (interpretation.intent === "give_name" && !session) return { text: replies.nameReceived(name) };
    }

    const scheduling = session ? interpretation.intent !== "question" : STARTERS.includes(interpretation.intent);
    if (!scheduling) return fromBrochure();

    // O tratamento citado por último pelo cliente vira o serviço do agendamento (specs/005 FR-010)
    const mentionedService = detectService([...history.filter((m) => m.role === "user").map((m) => m.content), text]);
    const result = await flow.handle({ conversation, interpretation, session, knownName: known, mentionedService });
    return { text: result.reply, ignorePause: result.handoff };
  };
}
