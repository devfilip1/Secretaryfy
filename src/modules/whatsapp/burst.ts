import type { FastifyBaseLogger } from "fastify";
import { createDebouncer } from "../antiban/debounce.js";
import type { IncomingMessage } from "./evolution.js";

/**
 * Uma tarefa de cada vez por conversa: a seguinte começa quando a anterior termina. `waited` diz se a tarefa esperou
 * outra, ou seja, o cliente escreveu enquanto respondíamos. ponytail: fila em memória, processo único.
 */
export function createSerialLanes() {
  const tails = new Map<string, Promise<void>>();
  return {
    run(conversationId: string, task: (waited: boolean) => Promise<void>): Promise<void> {
      const waited = tails.has(conversationId);
      const current = (tails.get(conversationId) ?? Promise.resolve()).then(() => task(waited));
      const tail = current.catch(() => undefined);
      tails.set(conversationId, tail);
      void tail.then(() => {
        if (tails.get(conversationId) === tail) tails.delete(conversationId);
      });
      return current;
    },
  };
}

export interface BurstDeps {
  /** Silêncio do cliente que fecha a rodada (ANTIBAN_DEBOUNCE_MS) */
  quietMs: number;
  /** Tudo que o cliente mandou e ainda não foi respondido, como uma mensagem só; null se não há texto */
  unanswered: (conversationId: string) => Promise<IncomingMessage | null>;
  handle: (
    input: { conversationId: string; message: IncomingMessage },
    log: FastifyBaseLogger,
    burst: { waited: boolean },
  ) => Promise<void>;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (timer: never) => void;
}

/**
 * Mensagens seguidas do cliente viram uma rodada só: o silêncio fecha a rodada e a resposta cobre tudo o que ficou sem
 * resposta. Rodadas da mesma conversa nunca rodam juntas, então a seguinte já vê a resposta anterior no histórico.
 */
export function createBursts({ quietMs, unanswered, handle, setTimeout: later, clearTimeout: cancelLater }: BurstDeps) {
  const lanes = createSerialLanes();
  const debouncer = createDebouncer<{ log: FastifyBaseLogger }>({
    delayMs: quietMs,
    onFire: (conversationId, { log }) => {
      lanes
        .run(conversationId, async (waited) => {
          const message = await unanswered(conversationId);
          if (message) await handle({ conversationId, message }, log, { waited });
        })
        .catch((err) => log.error({ err, conversationId }, "falha ao responder"));
    },
    setTimeout: later,
    clearTimeout: cancelLater,
  });

  return {
    /** Texto do cliente: a rodada responde depois do silêncio */
    push(conversationId: string, log: FastifyBaseLogger) {
      debouncer.push(conversationId, { log });
    },
    /** O operador respondeu: a resposta pendente não acontece */
    cancel(conversationId: string) {
      debouncer.cancel(conversationId);
    },
    /** Pedido de saída ou de volta: sem esperar o silêncio, mas na vez da conversa */
    now(conversationId: string, message: IncomingMessage, log: FastifyBaseLogger) {
      debouncer.cancel(conversationId);
      return lanes.run(conversationId, (waited) => handle({ conversationId, message }, log, { waited }));
    },
  };
}
