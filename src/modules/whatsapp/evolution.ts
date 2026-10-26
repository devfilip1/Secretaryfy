import { env } from "../../config/env.js";
import type { MessageType } from "../../db/schema.js";

type Fetch = typeof fetch;

/**
 * Envia uma mensagem de texto pela Evolution API (v2). `number` no formato 5511999999999. Devolve o id da mensagem.
 * Com `delayMs`, a Evolution mostra "digitando…" por esse tempo antes de enviar (specs/004, contracts/evolution.md).
 */
export async function sendWhatsAppText(
  number: string,
  text: string,
  { delayMs = 0, fetch: doFetch = fetch }: { delayMs?: number; fetch?: Fetch } = {},
): Promise<{ waId: string }> {
  const res = await doFetch(`${env.EVOLUTION_API_URL}/message/sendText/${env.EVOLUTION_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.EVOLUTION_API_KEY },
    body: JSON.stringify({ number, text, delay: delayMs, linkPreview: false }),
    // A resposta só chega depois do "digitando…"
    signal: AbortSignal.timeout(delayMs + 10_000),
  });
  if (!res.ok) {
    throw new Error(`Evolution API ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { key?: { id?: string } };
  if (!body.key?.id) throw new Error("Evolution API did not return key.id");
  return { waId: body.key.id };
}

/** Marca como lidas mensagens do cliente (specs/004 FR-005). */
export async function markMessagesRead(phone: string, waIds: string[], { fetch: doFetch = fetch }: { fetch?: Fetch } = {}) {
  if (!waIds.length) return;
  const res = await doFetch(`${env.EVOLUTION_API_URL}/chat/markMessageAsRead/${env.EVOLUTION_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.EVOLUTION_API_KEY },
    body: JSON.stringify({ readMessages: waIds.map((id) => ({ remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id })) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text()}`);
}

/** Mensagem individual recebida ou enviada pelo número conectado. */
export interface IncomingMessage {
  kind: "message";
  /** id da mensagem no WhatsApp; usado para não registrar o mesmo evento duas vezes */
  id: string;
  phone: string;
  pushName?: string;
  fromMe: boolean;
  type: MessageType;
  /** texto, ou legenda da mídia; null para mídia sem legenda */
  text: string | null;
  sentAt: Date;
}

export interface ConnectionEvent {
  kind: "connection";
  state: "open" | "connecting" | "close";
  number: string | null;
  /** O número saiu da sessão (statusReason 401, ex.: desconectado pelo celular); quedas passageiras não marcam */
  loggedOut?: true;
}

export interface QrCodeEvent {
  kind: "qrcode";
  qr: string;
}

export type EvolutionEvent = IncomingMessage | ConnectionEvent | QrCodeEvent;

type RawMessage = Record<string, Record<string, unknown> | string | undefined>;

/** Tipo e texto a partir da primeira chave conhecida de `data.message` (contracts/evolution.md). */
function extractContent(message: RawMessage | undefined): { type: MessageType; text: string | null } | null {
  if (!message) return null;
  const field = (key: string, prop: string) => {
    const v = (message[key] as Record<string, unknown> | undefined)?.[prop];
    return typeof v === "string" && v.trim() ? v : null;
  };

  if (typeof message.conversation === "string") return { type: "text", text: message.conversation };
  if (message.extendedTextMessage) return { type: "text", text: field("extendedTextMessage", "text") };
  if (message.imageMessage) return { type: "image", text: field("imageMessage", "caption") };
  if (message.videoMessage) return { type: "video", text: field("videoMessage", "caption") };
  if (message.audioMessage) return { type: "audio", text: null };
  if (message.documentMessage) {
    return { type: "document", text: field("documentMessage", "caption") ?? field("documentMessage", "fileName") };
  }
  if (message.documentWithCaptionMessage) {
    const inner = (message.documentWithCaptionMessage as { message?: RawMessage }).message;
    const doc = inner?.documentMessage as Record<string, unknown> | undefined;
    const caption = typeof doc?.caption === "string" && doc.caption.trim() ? doc.caption : null;
    return { type: "document", text: caption };
  }
  if (message.stickerMessage) return { type: "sticker", text: null };
  if (message.locationMessage || message.liveLocationMessage) return { type: "location", text: null };
  if (message.contactMessage) return { type: "contact", text: field("contactMessage", "displayName") };
  if (message.contactsArrayMessage) return { type: "contact", text: field("contactsArrayMessage", "displayName") };
  // Reações, apagar e editar ficam fora do escopo
  if (message.reactionMessage || message.protocolMessage) return null;
  // Só metadados, sem conteúdo
  if (Object.keys(message).every((key) => key === "messageContextInfo")) return null;
  return { type: "other", text: null };
}

function toDate(timestamp: unknown): Date {
  const seconds = typeof timestamp === "string" ? Number(timestamp) : timestamp;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

function jidToNumber(jid: unknown): string | null {
  if (typeof jid !== "string" || !jid) return null;
  return jid.split("@")[0].split(":")[0] || null;
}

const PHONE_JID = "@s.whatsapp.net";

/**
 * O JID com o número de telefone da conversa. Com o endereçamento por LID do WhatsApp, `remoteJid` vem como
 * "<id>@lid" e o número chega em `remoteJidAlt` (ou `senderPn`, nas versões anteriores da Evolution API).
 */
function phoneJid(key: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string } | undefined): string | null {
  const jid = key?.remoteJid;
  if (!jid) return null;
  if (jid.endsWith(PHONE_JID)) return jid;
  if (!jid.endsWith("@lid")) return null;
  return [key.remoteJidAlt, key.senderPn].find((alt) => alt?.endsWith(PHONE_JID)) ?? null;
}

function parseMessage(data: unknown): IncomingMessage | null {
  const item = (Array.isArray(data) ? data[0] : data) as
    | {
        key?: { id?: string; remoteJid?: string; remoteJidAlt?: string; senderPn?: string; fromMe?: boolean };
        pushName?: string;
        messageTimestamp?: unknown;
        message?: RawMessage;
      }
    | undefined;
  const jid = phoneJid(item?.key);
  // Ignora grupos, status e listas de transmissão
  if (!item?.key?.id || !jid) return null;

  const content = extractContent(item.message);
  if (!content) return null;
  if (content.type === "text" && !content.text?.trim()) return null;

  const fromMe = item.key.fromMe === true;
  return {
    kind: "message",
    id: item.key.id,
    phone: jid.split("@")[0],
    pushName: !fromMe && item.pushName ? item.pushName : undefined,
    fromMe,
    type: content.type,
    text: content.text,
    sentAt: toDate(item.messageTimestamp),
  };
}

/** Interpreta um evento do webhook da Evolution API. Devolve null para o que não interessa. */
export function parseEvolutionEvent(body: unknown): EvolutionEvent | null {
  const event = body as { event?: string; data?: Record<string, unknown> } | null;
  const name = event?.event?.toLowerCase().replace(/_/g, ".");
  if (!name || !event?.data) return null;

  switch (name) {
    case "messages.upsert":
    case "send.message":
      return parseMessage(event.data);
    case "connection.update": {
      const raw = event.data.state;
      const state = raw === "open" || raw === "connecting" ? raw : "close";
      const loggedOut = state === "close" && Number(event.data.statusReason) === 401;
      return { kind: "connection", state, number: jidToNumber(event.data.wuid), ...(loggedOut ? { loggedOut: true } : {}) };
    }
    case "qrcode.updated": {
      const qr = (event.data.qrcode as { base64?: string } | undefined)?.base64;
      return qr ? { kind: "qrcode", qr } : null;
    }
    default:
      return null;
  }
}
