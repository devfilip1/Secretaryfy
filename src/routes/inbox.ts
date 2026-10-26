import type { FastifyBaseLogger } from "fastify";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { createBreaker } from "../modules/antiban/breaker.js";
import { createGate } from "../modules/antiban/gate.js";
import { configFromEnv } from "../modules/antiban/limits.js";
import { createAntibanRepository } from "../modules/antiban/repository.js";
import { bus } from "../modules/inbox/events.js";
import { createCustomerRepository } from "../modules/customers/repository.js";
import { createInboxRepository } from "../modules/inbox/repository.js";
import { createInboxService } from "../modules/inbox/service.js";
import { markMessagesRead, sendWhatsAppText } from "../modules/whatsapp/evolution.js";
import { instance } from "../modules/whatsapp/instance.js";

type Log = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

export const antibanConfig = configFromEnv(env);

/** Instâncias do processo, compartilhadas pelo webhook e pela API do painel. */
export const inboxRepo = createInboxRepository(db);
/** Cadastro de clientes (specs/005); cada inclusão ou mudança de nome atualiza a aba Clientes do painel */
const customerStore = createCustomerRepository(db);
export const customerRepo: typeof customerStore = {
  ...customerStore,
  async upsert(input) {
    const row = await customerStore.upsert(input);
    bus.publish({ type: "customers.updated" });
    return row;
  },
};
export const inbox = createInboxService({
  repo: inboxRepo,
  customers: customerRepo,
  publish: bus.publish,
  retryMinIntervalMs: antibanConfig.retryMinIntervalMs,
});

// O portão nasce antes do Fastify; o logger do servidor chega depois, por `useProtectionLogger`
let logger: Log = console as unknown as Log;
const protectionLog: Log = {
  info: ((...args: unknown[]) => (logger.info as (...a: unknown[]) => void)(...args)) as Log["info"],
  warn: ((...args: unknown[]) => (logger.warn as (...a: unknown[]) => void)(...args)) as Log["warn"],
  error: ((...args: unknown[]) => (logger.error as (...a: unknown[]) => void)(...args)) as Log["error"],
};
export function useProtectionLogger(log: Log) {
  logger = log;
}

// Proteção do número contra banimento (specs/004): freio e portão único de envio
export const antibanRepo = createAntibanRepository(db);
export const breaker = createBreaker({
  repo: antibanRepo,
  config: antibanConfig,
  onChange: (state) => {
    gate.onBreakerChange(state).catch((err) => protectionLog.error({ err }, "falha ao avisar a mudança do freio"));
  },
});
export const gate = createGate({
  config: antibanConfig,
  repo: antibanRepo,
  inboxRepo,
  inbox,
  breaker,
  send: (phone, text, opts) => sendWhatsAppText(phone, text, opts),
  markRead: (phone, waIds) => markMessagesRead(phone, waIds),
  connectedNumber: () => instance.getState().number,
  publish: bus.publish,
  log: protectionLog,
});
