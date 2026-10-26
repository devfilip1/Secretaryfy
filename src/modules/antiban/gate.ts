import type { FastifyBaseLogger } from "fastify";
import type { ConversationRow, MessageRow } from "../../db/schema.js";
import type { Publish } from "../inbox/events.js";
import type { InboxRepository } from "../inbox/repository.js";
import type { InboxService, SendRisk } from "../inbox/service.js";
import { assessConversation } from "./assess.js";
import type { Breaker, BreakerState } from "./breaker.js";
import { warmupLimits, type AntibanConfig, type ProtectionJson } from "./limits.js";
import { stripLinks } from "./links.js";
import { createSendQueue, type BlockReason } from "./queue.js";
import type { AntibanRepository } from "./repository.js";
import { protectionNotes } from "./texts.js";
import { gapDelay, readDelay, thinkDelay, typingDelay } from "./typing.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CONNECTED_CACHE_MS = 60_000;

/** Motivos que destacam a conversa para o operador, com o registro no histórico (contracts/conversation.md). */
const FLAGGED: Partial<Record<BlockReason, string>> = {
  loop: protectionNotes.loop,
  daily_conversations: protectionNotes.dailyConversations,
  rate_limited: protectionNotes.rateLimited,
  paused: protectionNotes.paused,
};

export type SendOutcome = "sent" | "failed" | "blocked";

interface Deps {
  config: AntibanConfig;
  repo: Pick<AntibanRepository, "sentTimesSince" | "countConversationsServedSince" | "servedConversationSince" | "getConnectedNumber">;
  inboxRepo: Pick<
    InboxRepository,
    | "isOptedOut"
    | "lastCustomerMessageAt"
    | "customerMessagesSinceLastReply"
    | "recentForAssessment"
    | "assistantTextsSince"
    | "hasAssistantReply"
    | "operatorWroteSince"
  >;
  inbox: Pick<
    InboxService,
    "startOutgoing" | "finishOutgoing" | "recordBlocked" | "blockOutgoing" | "flagNeedsAttention" | "recordSystem" | "isPaused"
  >;
  breaker: Pick<Breaker, "current" | "recordFailure">;
  /** Envio pela Evolution API; `delayMs` é o "digitando…" */
  send: (phone: string, text: string, opts?: { delayMs?: number }) => Promise<{ waId: string }>;
  markRead: (phone: string, waIds: string[]) => Promise<void>;
  /** Número conectado agora, para o aquecimento */
  connectedNumber: () => string | null;
  publish: Publish;
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
  random?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

/**
 * O portão da proteção do número (specs/004, research.md R1): todo envio ao WhatsApp passa por aqui. As respostas do
 * assistente passam pelas regras e podem não sair; as do operador só esperam a vez na fila (os riscos ele confirma
 * antes, em `operatorRisks`). Um envio de cada vez, dentro dos limites, com intervalos que variam.
 */
export function createGate({
  config,
  repo,
  inboxRepo,
  inbox,
  breaker,
  send,
  markRead,
  connectedNumber,
  publish,
  log,
  now = () => new Date(),
  random = Math.random,
  setTimeout: later = setTimeout,
}: Deps) {
  // Envios feitos na última hora, semeados do banco na primeira vaga pedida (um reinício não zera os limites)
  let sentTimes: number[] | null = null;
  let lastSendAt: number | null = null;
  let nextGap = 0;
  let connected: { number: string | null; firstConnectedAt: Date | null; readAt: number } | null = null;

  const sleep = (ms: number) => new Promise<void>((resolve) => later(resolve, ms));

  async function firstConnectedAt(): Promise<Date | null> {
    const number = connectedNumber();
    const t = now().getTime();
    if (!connected || connected.number !== number || t - connected.readAt > CONNECTED_CACHE_MS) {
      const row = number ? await repo.getConnectedNumber(number) : null;
      connected = { number, firstConnectedAt: row?.firstConnectedAt ?? null, readAt: t };
    }
    return connected.firstConnectedAt;
  }

  async function currentLimits() {
    return warmupLimits(config, await firstConnectedAt(), now());
  }

  async function sendTimes(): Promise<number[]> {
    sentTimes ??= (await repo.sentTimesSince(new Date(now().getTime() - HOUR))).map((d) => d.getTime()).sort((a, b) => a - b);
    const since = now().getTime() - HOUR;
    while (sentTimes.length && sentTimes[0] <= since) sentTimes.shift();
    return sentTimes;
  }

  function recordAttempt(sent: boolean) {
    const t = now().getTime();
    if (sent) sentTimes?.push(t);
    lastSendAt = t;
    nextGap = gapDelay(config, random);
  }

  /** Espera a vaga nos limites por minuto e por hora e o intervalo desde o último envio (FR-009, FR-010). */
  async function waitForSlot(deadline: Date): Promise<boolean> {
    for (;;) {
      const times = await sendTimes();
      const limits = await currentLimits();
      const perMinute = Math.max(1, limits.perMinute);
      const perHour = Math.max(1, limits.perHour);
      const t = now().getTime();
      let at = t;
      const lastMinute = times.filter((x) => x > t - MINUTE);
      if (lastMinute.length >= perMinute) at = Math.max(at, lastMinute[lastMinute.length - perMinute] + MINUTE);
      if (times.length >= perHour) at = Math.max(at, times[times.length - perHour] + HOUR);
      if (lastSendAt !== null) at = Math.max(at, lastSendAt + nextGap);
      if (at > deadline.getTime()) return false;
      if (at <= t) return true;
      await sleep(at - t);
    }
  }

  const queue = createSendQueue({ now, waitForSlot });

  // --- Regras das respostas do assistente, na ordem em que são verificadas (tasks.md, "Ordem das regras") ---

  type Context = { conversationId: string; phone: string; text: string };
  type Rule = { name: BlockReason; check: (c: Context) => Promise<boolean> };

  const rules: Rule[] = [
    { name: "opted_out", check: ({ phone }) => inboxRepo.isOptedOut(phone) },
    { name: "paused", check: async () => (await breaker.current()).paused },
    {
      name: "outside_window",
      check: async ({ conversationId }) => isCold(await inboxRepo.lastCustomerMessageAt(conversationId)),
    },
    {
      name: "daily_conversations",
      check: async ({ conversationId }) => {
        const since = new Date(now().getTime() - DAY);
        if (await repo.servedConversationSince(conversationId, since)) return false;
        return (await repo.countConversationsServedSince(since)) >= (await currentLimits()).conversationsPerDay;
      },
    },
    {
      name: "loop",
      check: async ({ conversationId }) => assessConversation(await inboxRepo.recentForAssessment(conversationId), now(), config) === "loop",
    },
    {
      name: "unanswered",
      check: async ({ conversationId }) =>
        assessConversation(await inboxRepo.recentForAssessment(conversationId), now(), config) === "too_many_unanswered",
    },
    {
      name: "duplicate",
      check: async ({ conversationId, text }) => (await recentTexts(conversationId)).includes(text),
    },
  ];

  /** O primeiro motivo, na ordem das regras, para a resposta do assistente não sair; null se ela pode sair. */
  async function firstBlock(context: Context, bypass: BlockReason[] = []): Promise<BlockReason | null> {
    for (const rule of rules) {
      if (!bypass.includes(rule.name) && (await rule.check(context))) return rule.name;
    }
    return null;
  }

  function isCold(lastCustomerAt: Date | null) {
    return !lastCustomerAt || now().getTime() - lastCustomerAt.getTime() > DAY;
  }

  function recentTexts(conversationId: string) {
    return inboxRepo.assistantTextsSince(conversationId, new Date(now().getTime() - config.duplicateWindowMs));
  }

  /** Depois de não enviar: o motivo vai para o log, e alguns destacam a conversa (com laço, ela também é pausada). */
  async function afterBlock(conversationId: string, reason: BlockReason) {
    log.info({ conversationId, reason }, "resposta não enviada pela proteção");
    const note = FLAGGED[reason];
    if (!note) return;
    await inbox.flagNeedsAttention(conversationId);
    await inbox.recordSystem(conversationId, note);
  }

  /**
   * Como uma pessoa: só visualiza algum tempo depois da última mensagem do cliente (descontado o que já passou no
   * agrupamento e no modelo), e depois de visualizar faz uma pausa antes de começar a digitar (FR-005a, FR-005b).
   * Fica fora da fila de envio para não segurar as respostas de outras conversas.
   */
  async function readThenPause(conversationId: string, phone: string) {
    const unread = await inboxRepo.customerMessagesSinceLastReply(conversationId);
    if (unread.length === 0) return;

    const lastAt = Math.max(...unread.map((m) => m.sentAt.getTime()));
    const readAt = lastAt + readDelay(config, random);
    const waitRead = readAt - now().getTime();
    if (waitRead > 0) await sleep(waitRead);

    const waIds = unread.map((m) => m.waMessageId).filter((id): id is string => Boolean(id));
    try {
      await markRead(phone, waIds);
    } catch (err) {
      log.warn({ conversationId, err: (err as Error).message }, "falha ao marcar como lidas");
    }

    const thinkMs = thinkDelay(unread.map((m) => m.text ?? "").join(" "), config, random);
    await sleep(thinkMs);
    log.info({ conversationId, read_wait_ms: Math.max(0, waitRead), think_ms: thinkMs }, "mensagens visualizadas");
  }

  async function deliverAssistant(message: MessageRow, phone: string): Promise<SendOutcome> {
    const text = message.text ?? "";
    const delayMs = typingDelay(text, config, random);
    try {
      const { waId } = await send(phone, text, { delayMs });
      recordAttempt(true);
      log.info({ conversationId: message.conversationId, typing_ms: delayMs }, "envio liberado");
      await inbox.finishOutgoing(message.id, { waId });
      return "sent";
    } catch (err) {
      recordAttempt(false);
      log.error({ conversationId: message.conversationId, err }, "falha ao enviar pelo WhatsApp");
      await inbox.finishOutgoing(message.id, { error: (err as Error).message });
      await breaker.recordFailure();
      return "failed";
    }
  }

  const gate = {
    /**
     * Resposta do assistente. `ignorePause` vale para quem acabou de pausar a conversa (handoff, specs/003);
     * `bypass` pula regras que impediriam uma resposta obrigatória (a confirmação de saída).
     */
    async sendAssistant({
      conversationId,
      phone,
      text,
      ignorePause = false,
      bypass = [],
    }: {
      conversationId: string;
      phone: string;
      text: string;
      ignorePause?: boolean;
      bypass?: BlockReason[];
    }): Promise<SendOutcome> {
      const blocked = await firstBlock({ conversationId, phone, text }, bypass);
      if (blocked) {
        await inbox.recordBlocked({ conversationId, text, reason: blocked });
        await afterBlock(conversationId, blocked);
        return "blocked";
      }

      await readThenPause(conversationId, phone);

      const firstReply = !(await inboxRepo.hasAssistantReply(conversationId));
      const links = stripLinks(text, { firstReply, allowedDomains: config.allowedLinkDomains });
      if (links.removed) log.info({ conversationId, removed: links.removed }, "links retirados da resposta");

      const outgoing = await inbox.startOutgoing({ conversationId, origin: "assistant", text: links.text });
      const outcome = await queue.enqueue({
        expiresAt: new Date(now().getTime() + config.queueMaxAgeMs),
        check: async () => {
          if (!bypass.includes("paused") && (await breaker.current()).paused) return "paused";
          // O operador assumiu a conversa enquanto a resposta esperava
          if (!ignorePause && (await inbox.isPaused(conversationId))) return "superseded";
          if (await inboxRepo.operatorWroteSince(conversationId, outgoing.createdAt)) return "superseded";
          return null;
        },
        run: () => deliverAssistant(outgoing, phone),
      });
      if (outcome.ok) return outcome.value;
      await inbox.blockOutgoing(outgoing.id, outcome.reason);
      await afterBlock(conversationId, outcome.reason);
      return "blocked";
    },

    /**
     * O que `sendAssistant` faria com este texto agora, sem gravar nem destacar nada: o motivo do bloqueio ou null. O
     * agendador de lembretes consulta antes de enviar, para não encher o histórico de tentativas (specs/006 R4).
     */
    assistantBlockReason({ conversationId, phone, text }: { conversationId: string; phone: string; text: string }) {
      return firstBlock({ conversationId, phone, text });
    },

    /** Envio do operador: só espera a vez na fila. Se não sair, é uma falha para ele, que pode reenviar. */
    async sendOperator(phone: string, text: string): Promise<{ waId: string }> {
      const outcome = await queue.enqueue({
        expiresAt: new Date(now().getTime() + config.queueMaxAgeMs),
        run: async () => {
          try {
            const result = await send(phone, text);
            recordAttempt(true);
            return result;
          } catch (err) {
            recordAttempt(false);
            await breaker.recordFailure();
            throw err;
          }
        },
      });
      if (!outcome.ok) throw new Error(`Blocked by number protection: ${outcome.reason}`);
      return outcome.value;
    },

    /** Riscos que o operador confirma antes de enviar (FR-002, FR-027). */
    async operatorRisks(conversation: ConversationRow): Promise<SendRisk[]> {
      const risks: SendRisk[] = [];
      if (isCold(await inboxRepo.lastCustomerMessageAt(conversation.id))) risks.push("cold_contact");
      if (await inboxRepo.isOptedOut(conversation.phone)) risks.push("opted_out");
      if ((await breaker.current()).paused) risks.push("protection_paused");
      return risks;
    },

    /** Uma variação do texto fixo que o cliente não recebeu há pouco, ou null se já recebeu todas (FR-017). */
    async pickVariant(conversationId: string, options: string[]): Promise<string | null> {
      const recent = await recentTexts(conversationId);
      return options.find((option) => !recent.includes(option)) ?? null;
    },

    /** Estado da proteção para o painel (contracts/panel-api.md). */
    async protectionStatus(): Promise<ProtectionJson> {
      const state = await breaker.current();
      const limits = await currentLimits();
      const times = await sendTimes();
      const t = now().getTime();
      return {
        state: state.paused ? "paused" : limits.warmupUntil ? "warmup" : "normal",
        pausedUntil: state.pausedUntil?.toISOString() ?? null,
        reason: state.reason,
        warmupUntil: limits.warmupUntil?.toISOString() ?? null,
        limits: { perMinute: limits.perMinute, perHour: limits.perHour, conversationsPerDay: limits.conversationsPerDay },
        usage: {
          lastMinute: times.filter((x) => x > t - MINUTE).length,
          lastHour: times.length,
          conversationsToday: await repo.countConversationsServedSince(new Date(t - DAY)),
        },
      };
    },

    /** O freio mudou: com pausa, nada do que espera na fila sai; o painel é avisado nos dois sentidos. */
    async onBreakerChange(state: BreakerState) {
      if (state.paused) queue.drain("paused");
      await gate.publishStatus();
    },

    /** Um número foi conectado: relê o aquecimento e avisa o painel. */
    async onNumberConnected() {
      connected = null;
      await gate.publishStatus();
    },

    async publishStatus() {
      publish({ type: "protection.updated", ...(await gate.protectionStatus()) });
    },

    queueSize: () => queue.size(),
  };
  return gate;
}

export type Gate = ReturnType<typeof createGate>;
