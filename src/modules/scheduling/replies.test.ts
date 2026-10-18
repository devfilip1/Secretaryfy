import assert from "node:assert/strict";
import { test } from "node:test";
import { replies, systemNotes } from "./replies.js";

const tz = "America/Bahia";

test("listas numeradas a partir de 1, com as datas no fuso da clínica", () => {
  assert.equal(
    replies.offerDays(["2026-10-21", "2026-10-22"], tz),
    "Sure! These days have openings:\n1. Wed, Oct 21\n2. Thu, Oct 22\nReply with the number of the day, or tell me another date.",
  );
  const slots = [new Date("2026-10-21T12:00:00Z"), new Date("2026-10-21T13:00:00Z")];
  const text = replies.offerSlots("2026-10-21", slots, tz, true);
  assert.match(text, /^Available times on Wed, Oct 21:\n1\. 9:00 AM\n2\. 10:00 AM\n/);
  assert.match(text, /"more"/);
  assert.doesNotMatch(replies.offerSlots("2026-10-21", slots, tz, false), /"more"/);
});

test("confirmação mostra dia, hora, duração e nome; booked só com o horário", () => {
  const start = new Date("2026-10-21T13:00:00Z");
  assert.equal(
    replies.confirmBooking(start, 60, "Maria", tz),
    "Please confirm your appointment:\n📅 Wed, Oct 21 at 10:00 AM (60 min)\n👤 Maria\nReply YES to confirm or NO to choose another time.",
  );
  assert.equal(replies.booked(start, tz), "You're booked! 📅 Wed, Oct 21 at 10:00 AM. See you at DentalSafe.");
  assert.match(replies.tooLateToChange(1440), /less than 24 hours/);
  assert.match(replies.tooLateToChange(90), /less than 90 minutes/);
});

test("registros do painel em pt-BR", () => {
  const start = new Date("2026-10-21T13:00:00Z");
  const later = new Date("2026-10-23T17:00:00Z");
  assert.equal(systemNotes.booked(start, 60, tz), "📅 Agendado pelo assistente: qua, 21/10 às 10:00 (60 min)");
  assert.equal(systemNotes.rescheduled(start, later, tz), "📅 Remarcado pelo assistente: qua, 21/10 10:00 → sex, 23/10 14:00");
});
