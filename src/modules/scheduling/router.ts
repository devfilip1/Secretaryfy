import type { FastifyBaseLogger } from "fastify";
import { DateTime } from "luxon";
import type { ConnectionStore } from "../google/connection.js";
import type { InboxService } from "../inbox/service.js";
import type { ConversationTurn } from "../rag/client.js";
import type { IncomingMessage } from "../whatsapp/evolution.js";
import { splitReply, type Reply } from "../whatsapp/handle-message.js";
import { bookingWindow } from "./availability.js";
import type { SchedulingFlow } from "./flow.js";
import type { Intent, Interpreter } from "./interpret.js";
import { InterpreterUnavailable } from "./ollama.js";
import { systemNotes, type Replies } from "./replies.js";
import type { RulesStore } from "./rules.js";
import type { SchedulingStore } from "./sessions.js";

/** Intenções que começam um fluxo quando não há etapa em andamento (research.md R3). */
const STARTERS: Intent[] = ["book", "availability", "cancel", "reschedule", "my_appointment"];
/** Pede o nome no máximo duas vezes: na primeira resposta e, se o cliente seguiu sem dizer, mais uma vez depois de algumas mensagens */
const NAME_ASKS_MAX = 2;
const ASK_AGAIN_AFTER = 3;

interface Deps {
  interpreter: Pick<Interpreter, "interpret" | "mentionedService"> & Partial<Pick<Interpreter, "mentionedTime">>;
  flow: SchedulingFlow;
  store: Pick<SchedulingStore, "getSession" | "clearSession" | "findReminderAwaiting" | "confirm">;
  inbox: Pick<
    InboxService,
    "getConversation" | "flagNeedsAttention" | "recentHistory" | "knownName" | "setCustomerName" | "markNameAsked" | "customerMessagesSince" | "recordSystem"
  >;
  connection: Pick<ConnectionStore, "getForUse">;
  rules: Pick<RulesStore, "get">;
  /**
   * Resposta do folheto (RAG da feature 001), já com a mensagem de indisponibilidade em caso de falha. O histórico
   * resolve perguntas que dependem da anterior ("how much does it cost?" depois de perguntar da limpeza).
   */
  answerQuestion: (question: string, log: FastifyBaseLogger, phone: string, history?: ConversationTurn[]) => Promise<string>;
  now?: () => Date;
  /** Textos na língua da clínica (replies.ts, createReplies) */
  replies: Replies;
  /** Reescrita opcional da resposta do fluxo (humanize.ts); só o texto do fluxo passa por ela */
  humanize?: (reply: string, customerText: string, log: FastifyBaseLogger) => Promise<string>;
}

/** Decide se a mensagem vai para o agendamento ou para o folheto, e devolve o texto da resposta. */
export function createSchedulingRouter({ interpreter, flow, store, inbox, connection, rules, answerQuestion, now = () => new Date(), replies, humanize = async (reply) => reply }: Deps) {
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

    // O debounce junta em `text` todas as mensagens do cliente desde a nossa última resposta: elas saem do histórico
    const history = await inbox.recentHistory(conversationId);
    let pending = 0;
    while (history.at(-1)?.role === "user") {
      history.pop();
      pending++;
    }
    /** Nada nosso depois de `since`: as mensagens do cliente desde então são só as desta vez. */
    const justAsked = async (since: Date | null) => since !== null && (await inbox.customerMessagesSince(conversationId, since)) <= Math.max(1, pending);

    // Nome do cliente (specs/005, research.md R1 a R3): quem está no cadastro já é conhecido numa conversa nova
    let known = await inbox.knownName(conversation);
    if (known && !conversation.customerName) await inbox.setCustomerName(conversationId, known);
    // Só as mensagens desta vez depois do pedido podem ser o nome sozinho
    const awaitingName = !known && (await justAsked(conversation.nameAskedAt));

    // Resposta ao lembrete (specs/006 R5): sem agendamento em andamento, o lembrete saiu e o cliente mal respondeu desde então
    const reminded = session ? null : await store.findReminderAwaiting(conversation.phone, at);
    const awaitingReminder = Boolean(
      reminded?.reminderSentAt && (await justAsked(reminded.reminderSentAt)),
    );

    // A primeira resposta da conversa abre com a saudação pela hora do dia, como uma secretária (o histórico não tem resposta nossa)
    const firstReply = !history.some((m) => m.role === "assistant");
    const hour = DateTime.fromJSDate(at, { zone: timeZone }).hour;
    const opening = replies.greeting(hour);
    const greet = (reply: Reply): Reply =>
      firstReply
        ? { ...reply, text: `${opening}\n\n${reply.text}`, split: true }
        : reply;

    /**
     * O folheto vê a nossa saudação só como "Boa noite!": com o nome ele a repete ("Meu nome é Ana…"), e sem nenhuma ele
     * acha que a conversa começa agora e cumprimenta de novo ("Oi!"). Na primeira resposta ela ainda não está no histórico.
     */
    const shortHello = (h: number) => ({ role: "assistant" as const, content: replies.salutation(h) });
    const greetingHour = (content: string) => [6, 12, 18].find((h) => content.startsWith(replies.greeting(h)));
    const ragHistory = [
      ...history.map((m) => {
        const h = m.role === "assistant" ? greetingHour(m.content) : undefined;
        return h === undefined ? m : shortHello(h);
      }),
      ...(firstReply ? [shortHello(hour)] : []),
    ];

    /** Pede o nome no folheto ou na saudação, se ainda não foi pedido o máximo de vezes (FR-001, FR-002, FR-005). */
    async function askName(reply: Reply): Promise<Reply> {
      if (known) return reply;
      const { nameAsks, nameAskedAt } = conversation!;
      const firstAsk = nameAsks === 0;
      const askAgain =
        nameAsks < NAME_ASKS_MAX && nameAskedAt !== null && (await inbox.customerMessagesSince(conversationId, nameAskedAt)) >= ASK_AGAIN_AFTER;
      if (!firstAsk && !askAgain) return reply;
      await inbox.markNameAsked(conversationId, at);
      return { ...reply, followUp: replies.askNameFollowUp() };
    }

    /** Resposta do folheto; só numa conversa calma o pedido de nome vai junto (FR-001, FR-002, FR-005). */
    async function fromBrochure(calm: boolean): Promise<Reply> {
      const answer = await answerQuestion(text, log, message.phone, ragHistory);
      // A proteção descarta uma mensagem igual a uma já enviada: as partes repetidas ficam de fora (o cliente já as leu);
      // só quando a resposta inteira é repetida ela vai numa mensagem só, com uma abertura
      const said = history.filter((m) => m.role === "assistant").map((m) => m.content);
      const parts = splitReply(answer);
      const fresh = parts.filter((part) => !said.includes(part));
      const reply =
        fresh.length === 0 ? { text: `${replies.again()}\n${parts.join("\n")}` } : greet({ text: fresh.join("\n\n"), split: true });
      return calm ? askName(reply) : reply;
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
      return fromBrochure(false);
    }

    log.info(
      { phone: message.phone, intent: interpretation.intent, source: interpretation.source, step: session?.step ?? null, latency_ms: Date.now() - started },
      "mensagem interpretada",
    );

    // Instruções, prompt, troca de papel e assuntos alheios à clínica: o modelo só classifica, e o assunto volta para a clínica sem passar pelo folheto
    if (interpretation.intent === "manipulation" || interpretation.intent === "off_topic") return { text: replies.stayOnTopic() };

    // Xingamento: resposta breve e educada, sem pedido de nome nem oferta
    if (interpretation.intent === "rude") return { text: replies.calmDown() };

    // O que só a equipe pode decidir (pessoa, desconto, queixa, saúde): nada de resposta do modelo, só o aviso e a pausa
    if (interpretation.intent === "needs_staff") {
      const urgent = interpretation.urgent === true;
      await store.clearSession(conversationId);
      await inbox.flagNeedsAttention(conversationId);
      await inbox.recordSystem(conversationId, systemNotes.needsStaff(urgent));
      return { text: replies.staff(urgent), ignorePause: true };
    }

    // Quem atende e a saudação: o modelo reconhece a intenção, o texto é nosso
    if (interpretation.intent === "who_are_you") return { text: replies.myName() };
    if (interpretation.intent === "greeting") {
      const hello = firstReply ? `${opening} ${replies.howCanIHelp()}` : replies.howCanIHelp();
      return askName({ text: hello });
    }

    // Despedida: sem agendamento em andamento, só se despede; no meio de um, encerra o agendamento
    if (interpretation.intent === "goodbye") {
      if (!session) return { text: replies.goodbye(undefined, known) };
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
    if (!scheduling) return fromBrochure(interpretation.intent === "question");

    // Sem tratamento na interpretação nem na sessão, uma chamada focada ao modelo acha o que a conversa cita (sem regra por palavra);
    // a resposta só vale se a citação do cliente combina com o tratamento (ver mentionedService)
    const mentioned = interpretation.service || session?.service ? null : await interpreter.mentionedService({ history, text, log });

    // O horário citado ("as 14h"): o campo do interpretador vem às vezes vazio, então uma chamada focada o procura (ADR 0015)
    const wantsTime = ["book", "availability"].includes(interpretation.intent) || (interpretation.intent === "choose" && interpretation.option === null);
    const time = interpretation.time ?? (wantsTime ? await interpreter.mentionedTime?.({ text, log }) ?? null : null);
    const timed = time ? { ...interpretation, time } : interpretation;

    // O tratamento que o modelo viu na conversa (o citado por último) vira o serviço do agendamento (specs/005 FR-010)
    const result = await flow.handle({ conversation, interpretation: timed, session, knownName: known, mentionedService: interpretation.service ?? mentioned });
    // Handoff é texto fixo de quem atende; a reescrita só vale para a resposta do fluxo
    let out = result.handoff ? result.reply : await humanize(result.reply, text, log);
    // Um texto igual a um que já mandamos seria descartado pela proteção (repetido): quem pediu de novo recebe uma abertura
    if (!result.handoff && history.some((m) => m.role === "assistant" && m.content === out)) out = `${replies.again()}\n\n${out}`;
    return { ...(result.handoff ? { text: out } : greet({ text: out })), ignorePause: result.handoff };
  };
}
