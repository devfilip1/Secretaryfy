import { useTranslation } from "react-i18next";
import type { Message, SystemNote } from "../api";
import { useBlockReasonText } from "../i18n/blockReason";
import { useFormats } from "../i18n/formats";

type Params = Record<string, string | number>;

/**
 * Texto de um registro do histórico no idioma do painel. Cada frase é uma chave do inbox.json com interpolação; o
 * instante entra pela chave systemNote.at (dia da semana, data e hora no fuso da clínica, como em Agendamentos). Linha antiga (sem note) ou tipo que o painel
 * não conhece: mostra o texto que o servidor mandou.
 */
export function useSystemNoteText(message: Message): string {
  const { t } = useTranslation("inbox");
  const formats = useFormats(timeZoneOf(message.note));
  const reasonText = useBlockReasonText();
  const note = message.note;
  if (!note) return message.text ?? "";

  const at = (iso: string) => t("systemNote.at", { day: formats.day.format(new Date(iso)), time: formats.time.format(new Date(iso)) });
  // Serviço fixo vem como chave (FollowUp, Assessment) e sai no idioma do painel; um tratamento já é o título da clínica
  const serviceText = (service: string) => t(`systemNote.service.${service}` as never, { defaultValue: service });
  const [key, params] = keyAndParams(note, at, reasonText, serviceText);
  return t(`systemNote.${key}` as never, { ...params, defaultValue: message.text ?? "" });
}

/** Chave da frase e os valores que ela recebe, por tipo. */
function keyAndParams(
  note: SystemNote,
  at: (iso: string) => string,
  reasonText: (code: string | null) => string,
  serviceText: (service: string) => string,
): [string, Params] {
  switch (note.kind) {
    case "booked":
    case "booked_from_panel":
      return [note.kind, { when: at(note.start), minutes: note.minutes, service: serviceText(note.service) }];
    case "rescheduled":
      return [note.kind, { from: at(note.from), to: at(note.to) }];
    case "cancelled_by_customer":
    case "cancelled_by_staff":
    case "cancelled_in_calendar":
    case "reminder_sent":
    case "confirmed_by_customer":
    case "confirmed_by_operator":
      return [note.kind, { when: at(note.start) }];
    case "reminder_not_sent":
      return [note.kind, { when: at(note.start), reason: reasonText(note.reason) }];
    case "needs_staff":
      return [note.urgent ? "needs_staff_urgent" : "needs_staff", {}];
    case "protection_blocked":
      return [`protection_blocked.${note.reason}`, {}];
    default:
      return [note.kind, {}];
  }
}

/** Fuso da clínica da nota; os tipos sem data (needs_staff, handoff, opt-out...) não têm fuso. */
function timeZoneOf(note: SystemNote | null): string | undefined {
  return note && "timeZone" in note ? note.timeZone : undefined;
}
