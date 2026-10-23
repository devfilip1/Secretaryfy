import { env as appEnv } from "../../config/env.js";
import { bus, type ConnectionJson, type Publish } from "../inbox/events.js";
import type { ConnectionEvent, QrCodeEvent } from "./evolution.js";

/** A Evolution API respondeu com erro ou não respondeu. */
export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EvolutionError";
  }
}

export class AlreadyConnected extends Error {
  constructor() {
    super("o WhatsApp já está conectado");
    this.name = "AlreadyConnected";
  }
}

/** Pedidos de QR code demais seguidos (specs/004 FR-029). */
export class TooManyAttempts extends Error {
  constructor(readonly retryAt: Date) {
    super("muitas tentativas de conexão");
    this.name = "TooManyAttempts";
  }
}

const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "SEND_MESSAGE", "CONNECTION_UPDATE", "QRCODE_UPDATED"];
const POLL_MS = 10_000;

interface Options {
  fetch?: typeof fetch;
  publish?: Publish;
  env?: Pick<
    typeof appEnv,
    "EVOLUTION_API_URL" | "EVOLUTION_API_KEY" | "EVOLUTION_INSTANCE" | "EVOLUTION_WEBHOOK_TOKEN" | "PUBLIC_URL" | "WEBHOOK_BASE_URL"
  >;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  /** Pedidos de QR code permitidos por janela (specs/004 FR-029) */
  qrAttempts?: number;
  qrWindowMs?: number;
  now?: () => Date;
}

/** Conexão do número com a Evolution API: estado, QR code, webhook e desconexão (contracts/evolution.md). */
export function createInstanceManager({
  fetch: doFetch = fetch,
  publish = bus.publish,
  env = appEnv,
  setInterval: every = setInterval,
  clearInterval: stopEvery = clearInterval,
  qrAttempts = appEnv.ANTIBAN_QR_ATTEMPTS,
  qrWindowMs = appEnv.ANTIBAN_QR_WINDOW_MS,
  now = () => new Date(),
}: Options = {}) {
  const state: ConnectionJson = { state: "close", number: null, qr: null };
  // Horários dos últimos pedidos de QR code; cada tentativa nova é um sinal a mais para o WhatsApp
  const qrRequests: number[] = [];
  let known = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  // A Evolution abre um socket novo a cada /instance/connect com a instância fechada, sem encerrar o anterior;
  // sockets duplicados batem o limite de QR codes e derrubam a sessão logo depois do pareamento
  let pendingQr: Promise<ConnectionJson> | null = null;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${env.EVOLUTION_API_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json", apikey: env.EVOLUTION_API_KEY },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new EvolutionError(`Evolution API inacessível: ${(err as Error).message}`);
    }
    if (!res.ok) throw new EvolutionError(`Evolution API ${res.status}: ${await res.text().catch(() => "")}`, res.status);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  function update(patch: Partial<ConnectionJson>) {
    const next = { ...state, ...patch };
    // QR code só vale enquanto conecta; fechada, a instância precisa de um pedido novo
    if (next.state !== "connecting") next.qr = null;
    const changed = next.state !== state.state || next.number !== state.number || next.qr !== state.qr;
    Object.assign(state, next);
    known = true;
    if (changed) publish({ type: "connection.updated", ...state });
  }

  const instance = encodeURIComponent(env.EVOLUTION_INSTANCE);

  async function requestQr(): Promise<ConnectionJson> {
    try {
      const current = await manager.refresh();
      if (current.state === "open") throw new AlreadyConnected();
    } catch (err) {
      if (!(err instanceof EvolutionError && err.status === 404)) throw err;
      await call("POST", "/instance/create", {
        instanceName: env.EVOLUTION_INSTANCE,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
      });
    }
    await call("POST", `/webhook/set/${instance}`, {
      webhook: {
        enabled: true,
        url: `${env.WEBHOOK_BASE_URL ?? env.PUBLIC_URL}/webhooks/evolution?token=${encodeURIComponent(env.EVOLUTION_WEBHOOK_TOKEN)}`,
        byEvents: false,
        base64: false,
        events: WEBHOOK_EVENTS,
      },
    });
    const res = await call<{ base64?: string }>("GET", `/instance/connect/${instance}`);
    update({ state: "connecting", number: null, qr: res.base64 ?? state.qr });
    return manager.getState();
  }

  const manager = {
    getState(): ConnectionJson {
      return { ...state };
    },

    isKnown(): boolean {
      return known;
    },

    /** Eventos connection.update e qrcode.updated vindos do webhook. */
    applyEvent(event: ConnectionEvent | QrCodeEvent) {
      if (event.kind === "qrcode") update({ qr: event.qr, state: state.state === "open" ? "open" : "connecting" });
      else update({ state: event.state, number: event.state === "open" ? (event.number ?? state.number) : null });
    },

    /** Lê o estado atual na Evolution API. */
    async refresh(): Promise<ConnectionJson> {
      const res = await call<{ instance?: { state?: string } }>("GET", `/instance/connectionState/${instance}`);
      const raw = res.instance?.state;
      const current = raw === "open" || raw === "connecting" ? raw : "close";
      let number: string | null = null;
      if (current === "open") {
        const list = await call<Array<{ ownerJid?: string; owner?: string }>>(
          "GET",
          `/instance/fetchInstances?instanceName=${instance}`,
        );
        const jid = list[0]?.ownerJid ?? list[0]?.owner;
        number = jid ? jid.split("@")[0].split(":")[0] : null;
      }
      update({ state: current, number });
      return manager.getState();
    },

    /** Garante a instância e o webhook e pede um QR code novo. Pedidos simultâneos compartilham a mesma chamada. */
    prepareQr(): Promise<ConnectionJson> {
      if (!pendingQr) {
        const t = now().getTime();
        while (qrRequests.length && qrRequests[0] <= t - qrWindowMs) qrRequests.shift();
        if (qrRequests.length >= qrAttempts) return Promise.reject(new TooManyAttempts(new Date(qrRequests[0] + qrWindowMs)));
        qrRequests.push(t);
      }
      pendingQr ??= requestQr().finally(() => {
        pendingQr = null;
      });
      return pendingQr;
    },

    async logout(): Promise<void> {
      await call("DELETE", `/instance/logout/${instance}`);
      update({ state: "close", number: null, qr: null });
    },

    /** Consulta o estado a cada 10 s; usado só enquanto há painel aberto. */
    startPolling(onError?: (err: unknown) => void) {
      if (timer) return;
      timer = every(() => {
        manager.refresh().catch((err) => onError?.(err));
      }, POLL_MS);
    },

    stopPolling() {
      if (timer) stopEvery(timer);
      timer = null;
    },

    isPolling(): boolean {
      return timer !== null;
    },
  };
  return manager;
}

export type InstanceManager = ReturnType<typeof createInstanceManager>;

export const instance = createInstanceManager();
