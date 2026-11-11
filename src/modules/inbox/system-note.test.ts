import assert from "node:assert/strict";
import { test } from "node:test";
import { systemNoteText, type SystemNote } from "./system-note.js";

const start = "2026-10-21T13:00:00.000Z";
const later = "2026-10-23T17:00:00.000Z";
const timeZone = "America/Bahia";

test("cada tipo de registro tem o mesmo texto em inglês de antes da tipagem", () => {
  const table: [SystemNote, string][] = [
    [{ kind: "booked", start, minutes: 60, service: "Dental Cleaning", timeZone }, "Booked by the assistant: Wed, Oct 21 at 10:00 AM (60 min), Dental Cleaning"],
    [{ kind: "booked_from_panel", start, minutes: 60, service: "Dental Cleaning", timeZone }, "Booked from the panel: Wed, Oct 21 at 10:00 AM (60 min), Dental Cleaning"],
    [{ kind: "rescheduled", from: start, to: later, timeZone }, "Rescheduled by the assistant: Wed, Oct 21 at 10:00 AM → Fri, Oct 23 at 2:00 PM"],
    [{ kind: "cancelled_by_customer", start, timeZone }, "Cancelled by the customer: Wed, Oct 21 at 10:00 AM"],
    [{ kind: "cancelled_by_staff", start, timeZone }, "Cancelled from the panel: Wed, Oct 21 at 10:00 AM"],
    [{ kind: "cancelled_in_calendar", start, timeZone }, "Cancelled in the calendar: Wed, Oct 21 at 10:00 AM"],
    [
      { kind: "needs_staff", urgent: true },
      "Urgent: the customer needs the team (pain, swelling or another health problem). The assistant was paused in this conversation",
    ],
    [
      { kind: "needs_staff", urgent: false },
      "The customer needs someone from the team (a person, a discount or special condition, a complaint or medical advice). The assistant was paused in this conversation",
    ],
    [{ kind: "handoff" }, "The assistant did not understand the customer and was paused in this conversation"],
    [{ kind: "reminder_sent", start, timeZone }, "Reminder sent for Wed, Oct 21 at 10:00 AM"],
    [
      { kind: "reminder_not_sent", start, reason: "outside_window", timeZone },
      "Reminder not sent for Wed, Oct 21 at 10:00 AM: the customer has not written in over 24 h",
    ],
    [{ kind: "confirmed_by_customer", start, timeZone }, "Appointment confirmed by the customer: Wed, Oct 21 at 10:00 AM"],
    [{ kind: "confirmed_by_operator", start, timeZone }, "Appointment confirmed by the operator: Wed, Oct 21 at 10:00 AM"],
    [{ kind: "protection_blocked", reason: "loop" }, "Possibly talking to another bot: the assistant was paused"],
    [{ kind: "protection_blocked", reason: "daily_conversations" }, "Daily conversation limit reached: the assistant did not reply"],
    [{ kind: "protection_blocked", reason: "rate_limited" }, "The reply waited too long in the queue and was not sent"],
    [{ kind: "protection_blocked", reason: "paused" }, "Automatic sending paused by protection: the assistant did not reply"],
    [{ kind: "opted_out" }, "The customer asked not to receive messages"],
    [{ kind: "opted_in" }, "The customer accepts messages again"],
    [{ kind: "reactivated_by_operator" }, "Messages reactivated by the operator"],
  ];
  for (const [note, text] of table) assert.equal(systemNoteText(note), text, note.kind);
});

test("motivo de lembrete desconhecido aparece como o próprio código", () => {
  assert.equal(
    systemNoteText({ kind: "reminder_not_sent", start, reason: "weird", timeZone }),
    "Reminder not sent for Wed, Oct 21 at 10:00 AM: weird",
  );
});
