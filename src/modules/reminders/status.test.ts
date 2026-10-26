import assert from "node:assert/strict";
import { test } from "node:test";
import { initialReminderStatus, reminderLabel } from "./status.js";

const now = new Date("2026-10-20T15:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);
const LEAD = { leadMinutes: 1440 };
const appt = (over: Partial<Parameters<typeof reminderLabel>[0]>) => ({
  startsAt: hours(30),
  reminderStatus: "pending" as const,
  reminderReason: null,
  confirmedAt: null,
  ...over,
});

test("lembrete inicial: pendente com 24 h ou mais de antecedência, senão não é necessário", () => {
  assert.equal(initialReminderStatus(hours(24), now, 1440), "pending");
  assert.equal(initialReminderStatus(hours(48), now, 1440), "pending");
  assert.equal(initialReminderStatus(new Date(hours(24).getTime() - 1), now, 1440), "not_needed");
  assert.equal(initialReminderStatus(hours(2), now, 1440), "not_needed");
});

test("situação no painel: confirmação vence qualquer status do lembrete", () => {
  for (const reminderStatus of ["pending", "sent", "not_sent", "not_needed"] as const) {
    assert.equal(reminderLabel(appt({ reminderStatus, confirmedAt: now }), now, LEAD), "confirmed");
  }
});

test("situação no painel: pendente antes da janela é agendado; dentro dela, depende do motivo", () => {
  assert.equal(reminderLabel(appt({ startsAt: hours(30) }), now, LEAD), "scheduled");
  assert.equal(reminderLabel(appt({ startsAt: hours(30), reminderReason: "outside_window" }), now, LEAD), "scheduled");
  assert.equal(reminderLabel(appt({ startsAt: hours(24) }), now, LEAD), "scheduled");
  assert.equal(reminderLabel(appt({ startsAt: hours(10), reminderReason: "outside_window" }), now, LEAD), "remind_manually");
  assert.equal(reminderLabel(appt({ startsAt: hours(10), reminderReason: "no_conversation" }), now, LEAD), "remind_manually");
  assert.equal(reminderLabel(appt({ startsAt: hours(10), reminderReason: "paused" }), now, LEAD), "waiting");
  assert.equal(reminderLabel(appt({ startsAt: hours(10), reminderReason: "daily_conversations" }), now, LEAD), "waiting");
});

test("situação no painel: enviado, não enviado e não necessário", () => {
  assert.equal(reminderLabel(appt({ reminderStatus: "sent" }), now, LEAD), "sent");
  assert.equal(reminderLabel(appt({ reminderStatus: "not_sent", reminderReason: "opted_out" }), now, LEAD), "not_sent");
  assert.equal(reminderLabel(appt({ reminderStatus: "not_needed" }), now, LEAD), "not_needed");
});
