import type { AppointmentRow } from "../../db/schema.js";

/** Situação do lembrete e da confirmação mostrada no painel (specs/006 data-model.md). */
export type ReminderLabel = "confirmed" | "scheduled" | "remind_manually" | "waiting" | "sent" | "not_sent" | "not_needed";

/** Motivos em que só o operador consegue avisar: o cliente está fora da janela de 24 h ou nunca escreveu. */
const MANUAL_REASONS = new Set(["outside_window", "no_conversation"]);

/** Horário marcado com pelo menos `leadMinutes` de antecedência recebe lembrete; os outros, não (FR-020). */
export function initialReminderStatus(start: Date, now: Date, leadMinutes: number): "pending" | "not_needed" {
  return start.getTime() - now.getTime() >= leadMinutes * 60_000 ? "pending" : "not_needed";
}

type LabelInput = Pick<AppointmentRow, "startsAt" | "reminderStatus" | "reminderReason" | "confirmedAt">;

export function reminderLabel(appt: LabelInput, now: Date, { leadMinutes }: { leadMinutes: number }): ReminderLabel {
  if (appt.confirmedAt) return "confirmed";
  switch (appt.reminderStatus) {
    case "sent":
      return "sent";
    case "not_sent":
      return "not_sent";
    case "not_needed":
      return "not_needed";
    case "pending": {
      const inWindow = appt.startsAt.getTime() - now.getTime() <= leadMinutes * 60_000;
      if (!inWindow || !appt.reminderReason) return "scheduled";
      return MANUAL_REASONS.has(appt.reminderReason) ? "remind_manually" : "waiting";
    }
  }
}
