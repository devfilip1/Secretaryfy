import assert from "node:assert/strict";
import { test } from "node:test";
import { createReplies, type Replies } from "./replies.js";

const tz = "America/Bahia";
const start = new Date("2026-10-21T13:00:00Z");
const other = new Date("2026-10-23T17:00:00Z");
const slots = [new Date("2026-10-21T12:00:00Z"), new Date("2026-10-21T13:00:00Z")];

/** Uma chamada de cada método de Replies, com argumentos válidos. */
function everyCall(r: Replies): Record<keyof Replies, () => string | string[]> {
  return {
    offerDays: () => r.offerDays(["2026-10-21", "2026-10-22"], tz),
    offerSlots: () => r.offerSlots("2026-10-21", slots, tz, true),
    dayFull: () => r.dayFull("2026-10-21", ["2026-10-22"], tz),
    tooFar: () => r.tooFar(60, "2026-12-20", ["2026-10-22"], tz),
    noOpenings: () => r.noOpenings(),
    askName: () => r.askName(),
    chooseService: () => r.chooseService(),
    confirmBooking: () => r.confirmBooking(start, 60, "Maria", "Dental Cleaning", tz),
    booked: () => r.booked(start, tz),
    slotTaken: () => r.slotTaken("2026-10-21", slots, tz),
    alreadyBooked: () => r.alreadyBooked(start, tz),
    myAppointment: () => r.myAppointment(start, tz),
    noAppointment: () => r.noAppointment(),
    confirmCancel: () => r.confirmCancel(start, tz),
    cancelled: () => r.cancelled(start, tz),
    keptAppointment: () => r.keptAppointment(start, tz),
    confirmReschedule: () => r.confirmReschedule(start, other, tz),
    rescheduled: () => r.rescheduled(other, tz),
    tooLateToChange: () => r.tooLateToChange(1440),
    stopped: () => r.stopped(),
    askNameFollowUp: () => r.askNameFollowUp(() => 0),
    nameReceived: () => r.nameReceived("Maria", () => 0),
    goodbye: () => r.goodbye(() => 0),
    unclear: () => r.unclear("Como posso ajudar?"),
    handoff: () => r.handoff(),
    calendarUnavailable: () => r.calendarUnavailable(),
    interpreterUnavailable: () => r.interpreterUnavailable(),
    reminder: () => r.reminder(start, "Dental Cleaning", "Maria", tz),
    reminderConfirmed: () => r.reminderConfirmed(start, "Maria", tz),
    daysIntro: () => r.daysIntro(),
    noMoreOpeningsToday: () => r.noMoreOpeningsToday(),
    yesOrNo: () => r.yesOrNo(),
    howCanIHelp: () => r.howCanIHelp(),
  };
}

const pt = createReplies({ language: "pt", clinicName: "Clínica Sorriso" });

test("todo método de Replies devolve texto não vazio em português", () => {
  for (const [name, call] of Object.entries(everyCall(pt))) {
    const out = call();
    const texts = Array.isArray(out) ? out : [out];
    assert.ok(texts.length > 0, name);
    for (const text of texts) assert.ok(text.trim().length > 0, name);
  }
});

test("texto em pt usa a linguagem da clínica, sem o nome padrão quando a clínica tem outro", () => {
  for (const [name, call] of Object.entries(everyCall(pt))) {
    const out = call();
    const texts = Array.isArray(out) ? out : [out];
    for (const text of texts) assert.doesNotMatch(text, /DentalSafe/, name);
  }
  assert.equal(pt.booked(start, tz), "Tudo certo, seu horário está marcado! 📅 quarta-feira, 21 de outubro às 10:00. Até lá, na Clínica Sorriso.");
});

test("listas em pt com bolinhas (•), com dias por extenso e as linhas de horário", () => {
  const days = pt.offerDays(["2026-10-21", "2026-10-22"], tz);
  assert.match(days, /\n• quarta-feira, 21 de outubro\n• quinta-feira, 22 de outubro\n/);
  const times = pt.offerSlots("2026-10-21", slots, tz, false);
  assert.match(times, /\n• 09:00\n• 10:00\n/);
  assert.match(pt.chooseService(), /\n• Limpeza Dental\n/);
  assert.match(pt.chooseService(), /\n• Não tenho certeza — avaliação geral\n/);
});

test("confirmação pede SIM, e o lembrete também", () => {
  assert.match(pt.confirmBooking(start, 60, "Maria", "Dental Cleaning", tz), /Responda SIM para confirmar/);
  assert.match(pt.confirmBooking(start, 60, "Maria", "Dental Cleaning", tz), /🦷 Limpeza Dental/);
  for (const text of pt.reminder(start, "Dental Cleaning", "Maria", tz)) assert.match(text, /SIM/);
});

test("clínica em inglês continua com o nome configurado", () => {
  const en = createReplies({ language: "en", clinicName: "Smile Clinic" });
  assert.equal(en.booked(start, tz), "You're booked! 📅 Wednesday, October 21 at 10:00 AM. See you at Smile Clinic.");
});

test("horas de antecedência em pt", () => {
  assert.match(pt.tooLateToChange(1440), /menos de 24 horas/);
  assert.match(pt.tooLateToChange(60), /menos de 1 hora/);
  assert.match(pt.tooLateToChange(90), /menos de 90 minutos/);
});
