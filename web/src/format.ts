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

const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Hora, se for hoje; data curta nos outros casos. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? timeFmt.format(date) : dateFmt.format(date);
}

export function formatDateTime(iso: string): string {
  return fullFmt.format(new Date(iso));
}

const ORIGIN_LABELS: Record<Origin, string> = {
  customer: "Cliente",
  assistant: "Assistente",
  operator: "Operador",
  phone: "Celular",
  system: "Secretaryfy",
};

export const originLabel = (origin: Origin) => ORIGIN_LABELS[origin];

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

export const mediaLabel = (type: MessageType) => (type === "text" ? null : MEDIA_LABELS[type]);
