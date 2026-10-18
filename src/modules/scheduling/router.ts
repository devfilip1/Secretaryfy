import type { FastifyBaseLogger } from "fastify";
import type { ConnectionStore } from "../google/connection.js";
import type { InboxService } from "../inbox/service.js";
import type { IncomingMessage } from "../whatsapp/evolution.js";
import type { Reply } from "../whatsapp/handle-message.js";
import { bookingWindow } from "./availability.js";
import type { SchedulingFlow } from "./flow.js";
import type { Intent, Interpreter } from "./interpret.js";
import { InterpreterUnavailable } from "./ollama.js";
import { replies } from "./replies.js";
import type { RulesStore } from "./rules.js";
import type { SchedulingStore } from "./sessions.js";

/** Intenções que começam um fluxo quando não há etapa em andamento (research.md R3). */
const STARTERS: Intent[] = ["book", "availability", "cancel", "reschedule", "my_appointment"];

interface Deps {
  interpreter: Interpreter;
  flow: SchedulingFlow;
  store: Pick<SchedulingStore, "getSession">;
  inbox: Pick<InboxService, "getConversation" | "recentHistory">;
  connection: Pick<ConnectionStore, "getForUse">;
  rules: Pick<RulesStore, "get">;
  /** Resposta do folheto (RAG da feature 001), já com a mensagem de indisponibilidade em caso de falha */
  answerQuestion: (question: string, log: FastifyBaseLogger, phone: string) => Promise<string>;
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
      });
    } catch (err) {
      if (!(err instanceof InterpreterUnavailable)) throw err;
      log.error({ phone: message.phone, err: err.message }, "interpretador indisponível");
      // Sem fluxo em andamento, a mensagem segue para o folheto como na feature 001
      return { text: session ? replies.interpreterUnavailable() : await answerQuestion(text, log, message.phone) };
    }

    log.info(
      { phone: message.phone, intent: interpretation.intent, source: interpretation.source, step: session?.step ?? null, latency_ms: Date.now() - started },
      "mensagem interpretada",
    );

    const scheduling = session ? interpretation.intent !== "question" : STARTERS.includes(interpretation.intent);
    if (!scheduling) return { text: await answerQuestion(text, log, message.phone) };

    const result = await flow.handle({ conversation, interpretation, session });
    return { text: result.reply, ignorePause: result.handoff };
  };
}
