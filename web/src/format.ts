import type { MessageType, Origin } from "./api";

/** +55 11 99999-9999 para números do Brasil; + e os dígitos nos outros casos. */
export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    const cut = rest.length - 4;
    return `+55 ${ddd} ${rest.slice(0, cut)}-${rest.slice(cut)}`;
  }
  return `+${d}`;
}

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" });

/** Hora, se for hoje; data curta nos outros casos. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? timeFmt.format(date) : dateFmt.format(date);
}

export function formatDateTime(iso: string): string {
  return fullFmt.format(new Date(iso));
}

const ORIGIN_LABELS: Record<Origin, string> = {
  customer: "Customer",
  assistant: "Assistant",
  operator: "Operator",
  phone: "Phone",
  system: "Secretaryfy",
};

export const originLabel = (origin: Origin) => ORIGIN_LABELS[origin];

const MEDIA_LABELS: Record<Exclude<MessageType, "text">, string> = {
  audio: "🎤 Audio",
  image: "📷 Image",
  video: "🎬 Video",
  document: "📄 Document",
  sticker: "🖼️ Sticker",
  location: "📍 Location",
  contact: "👤 Contact",
  other: "Unsupported message",
};

export const mediaLabel = (type: MessageType) => (type === "text" ? null : MEDIA_LABELS[type]);

/** Por que a proteção do número não enviou, ou por que o lembrete não saiu (specs/004 data-model.md, specs/006). */
const BLOCK_REASONS: Record<string, string> = {
  outside_window: "the customer has not written in over 24 h",
  rate_limited: "waited too long in the queue",
  daily_conversations: "daily conversation limit reached",
  unanswered: "too many messages in a row without a customer reply",
  loop: "possibly talking to another bot",
  duplicate: "repeated text",
  opted_out: "the customer asked not to receive messages",
  paused: "automatic sending paused by protection",
  restart: "server restarted before sending",
  superseded: "the operator replied first",
  no_conversation: "no WhatsApp conversation with this number",
  failed: "WhatsApp send failed",
  blocked: "blocked by number protection",
  too_late: "less than 2 hours before the appointment",
};

export const blockReasonText = (reason: string | null) => (reason && BLOCK_REASONS[reason]) ?? reason ?? "";
