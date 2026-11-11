import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppointmentRow, SchedulingSessionRow } from "../../db/schema.js";
import { setup, SESSION } from "../../test/router-harness.js";

// --- Resposta ao lembrete (specs/006 US4) ---

const REMINDED = {
  id: "a1",
  startsAt: new Date("2026-10-21T13:00:00Z"),
  reminderSentAt: new Date("2026-10-20T13:00:00Z"),
} as AppointmentRow;

test("lembrete enviado + YES: confirma, registra e agradece pelo nome, sem abrir fluxo", async () => {
  const r = setup({ intent: "yes", reminded: REMINDED });
  assert.deepEqual(await r.reply(), {
    text: "Thank you, Maria! Your appointment on Wednesday, October 21 at 10:00 AM is confirmed. See you at DentalSafe.",
  });
  assert.equal(r.inputs[0].awaitingReminder, true);
  assert.deepEqual(r.confirmed, ["a1"]);
  assert.deepEqual(r.notes, ["Appointment confirmed by the customer: Wed, Oct 21 at 10:00 AM"]);
  assert.equal(r.handled.length, 0);
});

test("lembrete enviado + NO: vira a pergunta de remarcação do fluxo", async () => {
  const r = setup({ intent: "no", reminded: REMINDED });
  assert.deepEqual(await r.reply(), { text: "do agendamento", ignorePause: undefined });
  assert.equal(r.handled[0].interpretation.intent, "book");
  assert.deepEqual(r.confirmed, []);
});

test("lembrete enviado + cancelar: segue para o fluxo como sempre", async () => {
  const r = setup({ intent: "cancel", reminded: REMINDED });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "cancel");
  assert.deepEqual(r.confirmed, []);
});

test("com agendamento em andamento, o YES vale para a pergunta aberta, não para o lembrete", async () => {
  const r = setup({ intent: "yes", reminded: REMINDED, session: { ...SESSION, step: "confirm_booking" } as SchedulingSessionRow });
  await r.reply();
  assert.equal(r.inputs[0].awaitingReminder, false);
  assert.deepEqual(r.confirmed, []);
  assert.equal(r.handled[0].interpretation.intent, "yes");
});

test("o cliente já mandou outras mensagens depois do lembrete: um yes solto não confirma", async () => {
  const r = setup({ intent: "yes", reminded: REMINDED, messagesSinceReminder: 3 });
  await r.reply();
  assert.equal(r.inputs[0].awaitingReminder, false);
  assert.deepEqual(r.confirmed, []);
});
