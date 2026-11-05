import assert from "node:assert/strict";
import { test } from "node:test";
import { reminderReasonText, replies, systemNotes } from "./replies.js";

const tz = "America/Bahia";

test("listas em bullets, com os dias por extenso no fuso da clínica", () => {
  assert.equal(
    replies.offerDays(["2026-10-21", "2026-10-22"], tz),
    "Sure! These days have openings:\n• Wednesday, October 21\n• Thursday, October 22\nWhich one works best for you? Or tell me another date.",
  );
  const slots = [new Date("2026-10-21T12:00:00Z"), new Date("2026-10-21T13:00:00Z")];
  const text = replies.offerSlots("2026-10-21", slots, tz, true);
  assert.match(text, /^On Wednesday, October 21 I have these times:\n• 9:00 AM\n• 10:00 AM\nWhich one would you like\? I can show more times/);
  assert.doesNotMatch(replies.offerSlots("2026-10-21", slots, tz, false), /I can show more times/);
});

test("confirmação mostra dia, hora, duração, nome e serviço; booked só com o horário", () => {
  const start = new Date("2026-10-21T13:00:00Z");
  assert.equal(
    replies.confirmBooking(start, 60, "Maria", "Dental Cleaning", tz),
    "Please confirm your appointment:\n📅 Wednesday, October 21 at 10:00 AM (60 min)\n👤 Maria\n🦷 Dental Cleaning\nReply YES to confirm, NO to choose another time, or tell me another service.",
  );
  assert.match(replies.confirmBooking(start, 60, "Maria", "Assessment", tz), /🦷 General assessment/);
  assert.equal(replies.booked(start, tz), "You're booked! 📅 Wednesday, October 21 at 10:00 AM. See you at DentalSafe.");
  assert.match(replies.tooLateToChange(1440), /less than 24 hours/);
  assert.match(replies.tooLateToChange(90), /less than 90 minutes/);
});

test("registros do painel em inglês", () => {
  const start = new Date("2026-10-21T13:00:00Z");
  const later = new Date("2026-10-23T17:00:00Z");
  assert.equal(
    systemNotes.booked(start, 60, tz, "Dental Cleaning"),
    "📅 Booked by the assistant: Wed, Oct 21 at 10:00 AM (60 min) — Dental Cleaning",
  );
  assert.equal(systemNotes.rescheduled(start, later, tz), "📅 Rescheduled by the assistant: Wed, Oct 21 at 10:00 AM → Fri, Oct 23 at 2:00 PM");
});

test("pedido de nome e nome recebido: textos do contrato, sem convite para agendar", () => {
  const asks = [0, 0.4, 0.9].map((r) => replies.askNameFollowUp(() => r));
  assert.deepEqual(new Set(asks), new Set(["By the way, may I have your name?", "By the way, what's your name?", "Before I forget, may I have your name?"]));
  assert.equal(replies.nameReceived("Maria", () => 0), "Nice to meet you, Maria! How can I help you?");
  assert.equal(replies.nameReceived("Maria", () => 0.9), "Thanks, Maria! How can I help you today?");
});

test("lista de serviços: os 8 tratamentos em bullets e a avaliação geral no fim", () => {
  const lines = replies.chooseService().split("\n");
  assert.equal(lines[0], "Which service is this appointment for?");
  assert.equal(lines[1], "• Dental Cleaning");
  assert.equal(lines[8], "• Dental Veneers");
  assert.equal(lines[9], "• Not sure — general assessment");
  assert.equal(lines[10], "Just tell me which one.");
});

test("lembrete (specs/006): três variações diferentes, com dia, hora, serviço e YES, sem links", () => {
  const start = new Date("2026-10-21T13:00:00Z");
  const withName = replies.reminder(start, "Dental Cleaning", "Maria", tz);
  assert.equal(new Set(withName).size, 3);
  for (const text of withName) {
    assert.match(text, /Maria/);
    assert.match(text, /Wednesday, October 21 at 10:00 AM/);
    assert.match(text, /Dental Cleaning/);
    assert.match(text, /YES/);
    assert.doesNotMatch(text, /https?:|www\./);
  }
  assert.equal(withName[0], "Hi Maria! Just a reminder of your appointment at DentalSafe on Wednesday, October 21 at 10:00 AM (Dental Cleaning). Please reply YES to confirm.");
  const anonymous = replies.reminder(start, "Assessment", null, tz);
  assert.match(anonymous[0], /^Hi! .*\(General assessment\)/);
  assert.match(anonymous[1], /^Hello, your General assessment appointment/);
});

test("resposta ao YES e registros do lembrete no painel", () => {
  const start = new Date("2026-10-21T13:00:00Z");
  assert.equal(replies.reminderConfirmed(start, "Maria", tz), "Thank you, Maria! Your appointment on Wednesday, October 21 at 10:00 AM is confirmed. See you at DentalSafe.");
  assert.equal(replies.reminderConfirmed(start, null, tz), "Thank you! Your appointment on Wednesday, October 21 at 10:00 AM is confirmed. See you at DentalSafe.");
  assert.equal(systemNotes.reminderSent(start, tz), "🔔 Reminder sent for Wed, Oct 21 at 10:00 AM");
  assert.equal(
    systemNotes.reminderNotSent(start, reminderReasonText("outside_window"), tz),
    "🔔 Reminder not sent for Wed, Oct 21 at 10:00 AM: the customer has not written in over 24 h",
  );
  assert.equal(systemNotes.confirmedByCustomer(start, tz), "✅ Appointment confirmed by the customer: Wed, Oct 21 at 10:00 AM");
  assert.equal(systemNotes.confirmedByOperator(start, tz), "✅ Appointment confirmed by the operator: Wed, Oct 21 at 10:00 AM");
  assert.equal(systemNotes.bookedFromPanel(start, 60, tz, "Dental Cleaning"), "📅 Booked from the panel: Wed, Oct 21 at 10:00 AM (60 min) — Dental Cleaning");
  assert.equal(reminderReasonText("weird"), "weird");
});
