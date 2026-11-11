import assert from "node:assert/strict";
import { test } from "node:test";
import type { SystemNote } from "../api";
import { SYSTEM_NOTE_KINDS } from "./system-note-kinds";
import { toneOfNote, type NoteTone } from "./system-note-tone";

// Tom esperado de cada tipo; um tipo novo em SYSTEM_NOTE_KINDS sem linha aqui falha o teste.
const EXPECTED: Record<(typeof SYSTEM_NOTE_KINDS)[number], NoteTone> = {
  booked: "ok",
  booked_from_panel: "ok",
  rescheduled: "info",
  cancelled_by_customer: "warn",
  cancelled_by_staff: "warn",
  cancelled_in_calendar: "warn",
  needs_staff: "warn",
  handoff: "warn",
  reminder_sent: "ok",
  reminder_not_sent: "warn",
  confirmed_by_customer: "ok",
  confirmed_by_operator: "ok",
  protection_blocked: "warn",
  opted_out: "warn",
  opted_in: "ok",
  reactivated_by_operator: "info",
};

test("cada tipo de registro tem um tom esperado", () => {
  for (const kind of SYSTEM_NOTE_KINDS) {
    assert.ok(kind in EXPECTED, `${kind} sem tom esperado no teste`);
    assert.equal(toneOfNote({ kind } as SystemNote), EXPECTED[kind], kind);
  }
});

test("needs_staff urgente é alerta; não urgente, aviso", () => {
  assert.equal(toneOfNote({ kind: "needs_staff", urgent: true }), "alert");
  assert.equal(toneOfNote({ kind: "needs_staff", urgent: false }), "warn");
});

test("sem registro (linha antiga) o tom é neutro", () => {
  assert.equal(toneOfNote(null), "neutral");
});
