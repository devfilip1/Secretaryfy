import type { SystemNote } from "../api";

/** Cor de um registro do histórico conforme a situação: alerta (urgente), aviso, ok, informação ou neutro (linha antiga). */
export type NoteTone = "alert" | "warn" | "ok" | "info" | "neutral";

/**
 * Tom de cada tipo de registro. O switch é exaustivo: um tipo novo do SystemNote (api.ts) não compila até ganhar um tom.
 */
export function toneOfNote(note: SystemNote | null): NoteTone {
  if (!note) return "neutral";
  switch (note.kind) {
    case "needs_staff":
      return note.urgent ? "alert" : "warn";
    case "handoff":
    case "protection_blocked":
    case "opted_out":
    case "reminder_not_sent":
    case "cancelled_by_customer":
    case "cancelled_by_staff":
    case "cancelled_in_calendar":
      return "warn";
    case "booked":
    case "booked_from_panel":
    case "confirmed_by_customer":
    case "confirmed_by_operator":
    case "reminder_sent":
    case "opted_in":
      return "ok";
    case "rescheduled":
    case "reactivated_by_operator":
      return "info";
    default: {
      const unmapped: never = note;
      return unmapped;
    }
  }
}
