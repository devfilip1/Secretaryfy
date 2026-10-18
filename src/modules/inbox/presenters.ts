import type { ConversationRow, MessageRow, MessageType } from "../../db/schema.js";

/** Formatos do contrato: specs/002-whatsapp-web-inbox/contracts/panel-api.md */
export interface ConversationJson {
  id: string;
  phone: string;
  name: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  assistantPaused: boolean;
  needsAttention: boolean;
}

export interface MessageJson {
  id: string;
  origin: MessageRow["origin"];
  type: MessageType;
  text: string | null;
  status: MessageRow["status"];
  error: string | null;
  sentAt: string;
}

const MEDIA_LABELS: Record<Exclude<MessageType, "text">, string> = {
  audio: "🎤 Áudio",
  image: "📷 Imagem",
  video: "🎬 Vídeo",
  document: "📄 Documento",
  sticker: "🖼️ Figurinha",
  location: "📍 Localização",
  contact: "👤 Contato",
  other: "Mensagem não suportada",
};

export const PREVIEW_MAX = 120;

export function mediaLabel(type: MessageType): string | null {
  return type === "text" ? null : MEDIA_LABELS[type];
}

/** Texto da mensagem, ou o rótulo da mídia seguido da legenda, cortado em 120 caracteres. */
export function previewOf({ type, text }: { type: MessageType; text: string | null }): string {
  const label = mediaLabel(type);
  const full = label ? (text ? `${label} — ${text}` : label) : (text ?? "");
  return full.length > PREVIEW_MAX ? `${full.slice(0, PREVIEW_MAX - 1)}…` : full;
}

export function presentConversation(row: ConversationRow): ConversationJson {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessagePreview: row.lastMessagePreview,
    unreadCount: row.unreadCount,
    assistantPaused: row.assistantPaused,
    needsAttention: row.needsAttention,
  };
}

export function presentMessage(row: MessageRow): MessageJson {
  return {
    id: row.id,
    origin: row.origin,
    type: row.type,
    text: row.text,
    status: row.status,
    error: row.error,
    sentAt: row.sentAt.toISOString(),
  };
}
