import type { SystemNote } from "../api";

/**
 * Tipos de registro do histórico, um por `kind` do SystemNote (espelho de src/modules/inbox/system-note.ts). Cada tipo
 * tem uma chave systemNote.<tipo> em en e pt no inbox.json (protection_blocked tem uma sub-chave por motivo).
 */
export const SYSTEM_NOTE_KINDS = [
  "booked",
  "booked_from_panel",
  "rescheduled",
  "cancelled_by_customer",
  "cancelled_by_staff",
  "cancelled_in_calendar",
  "needs_staff",
  "handoff",
  "reminder_sent",
  "reminder_not_sent",
  "confirmed_by_customer",
  "confirmed_by_operator",
  "protection_blocked",
  "opted_out",
  "opted_in",
  "reactivated_by_operator",
] as const;

type ListedKind = (typeof SYSTEM_NOTE_KINDS)[number];

/** Falha de compilação se um tipo novo do SystemNote não entrar na lista. */
export const ALL_KINDS_LISTED: [Exclude<SystemNote["kind"], ListedKind>] extends [never] ? true : false = true;
