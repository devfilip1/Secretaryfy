import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES } from "../rules.js";
import { at, useFlowHarness } from "../../../test/flow-harness.js";

const h = useFlowHarness();
const { say, conversation, I, sessionOf, systemNotes, hasNote, allAppointments, book } = h;

// --- US5: consultar, cancelar e remarcar ---

test("my_appointment mostra o horário atual, inclusive se foi movido no Google", async () => {
  const conv = await conversation();
  assert.equal((await say(conv, I("my_appointment"))).reply, "I couldn't find an appointment for this number.");
  await book(conv);
  const [event] = [...h.fake.events.values()];
  event.start = at("2026-10-22T14:00");
  event.end = at("2026-10-22T15:00");
  assert.equal((await say(conv, I("my_appointment"))).reply, "Your appointment is on Thursday, October 22 at 2:00 PM.");
  const [appt] = await allAppointments();
  assert.equal(appt.startsAt.toISOString(), at("2026-10-22T14:00").toISOString());
});

test("cancelar: confirmação, evento apagado, cancelado pelo cliente e registro", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  assert.equal((await say(conv, I("cancel"))).reply, "Do you really want to cancel your appointment on Wednesday, October 21 at 10:00 AM?");
  assert.equal((await say(conv, I("yes"))).reply, "Your appointment on Wednesday, October 21 at 10:00 AM was cancelled.");
  assert.equal(h.fake.events.size, 0);
  const [appt] = await allAppointments();
  assert.equal(appt.status, "cancelled");
  assert.equal(appt.cancelledBy, "customer");
  assert.ok(hasNote(await systemNotes(conv), { kind: "cancelled_by_customer", start: "2026-10-21T13:00:00.000Z", timeZone: "America/Bahia" }));
});

test("no na confirmação do cancelamento mantém o horário", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  await say(conv, I("cancel"));
  assert.match((await say(conv, I("no"))).reply, /stays as it is/);
  assert.equal(h.fake.events.size, 1);
});

test("remarcar: escolhe dia e horário, confirma e o evento é movido", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  assert.match((await say(conv, I("reschedule"))).reply, /^Sure! These days have openings/);
  await say(conv, I("choose", { option: 4 }));
  const confirm = await say(conv, I("choose", { option: 6 }));
  assert.equal(confirm.reply, "Shall I move your appointment from Wednesday, October 21 at 10:00 AM to Friday, October 23 at 2:00 PM?");
  assert.equal((await say(conv, I("yes"))).reply, "Done! Your appointment is now on Friday, October 23 at 2:00 PM.");

  assert.equal(h.fake.calls.moveEvent, 1);
  const [event] = [...h.fake.events.values()];
  assert.equal(event.start.toISOString(), at("2026-10-23T14:00").toISOString());
  const [appt] = await allAppointments();
  assert.equal(appt.startsAt.toISOString(), at("2026-10-23T14:00").toISOString());
  assert.ok(hasNote(await systemNotes(conv), { kind: "rescheduled", from: "2026-10-21T13:00:00.000Z", to: "2026-10-23T17:00:00.000Z", timeZone: "America/Bahia" }));
});

test("yes na oferta de remarcar entra no fluxo de remarcação", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  await say(conv, I("book"));
  assert.match((await say(conv, I("yes"))).reply, /^Sure! These days have openings/);
  const s = await sessionOf(conv);
  assert.equal(s?.flow, "reschedule");
  assert.ok(s?.appointmentId);
});

test("dentro do prazo de cancelamento: too_late_to_change sem mexer na agenda (FR-027)", async () => {
  h.rules = { ...DEFAULT_RULES, minNoticeMinutes: 0 };
  const conv = await conversation();
  // Hoje às 16:00, daqui a 1 h, com prazo de 24 h
  await book(conv, 1, 2);
  const [appt] = await allAppointments();
  assert.equal(appt.startsAt.toISOString(), at("2026-10-20T16:00").toISOString());
  const { reply } = await say(conv, I("cancel"));
  assert.equal(reply, "Your appointment is in less than 24 hours, so I can't change it here. Please contact the clinic directly.");
  assert.match((await say(conv, I("reschedule"))).reply, /less than 24 hours/);
  assert.equal(h.fake.calls.deleteEvent, 0);
  assert.equal(h.fake.calls.moveEvent, 0);
});

test("evento apagado no Google antes do yes do cancelamento: no_appointment e registro", async () => {
  // Prazo curto: o horário de quarta (19 h à frente) pode ser mudado
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  await say(conv, I("cancel"));
  h.fake.events.clear();
  assert.equal((await say(conv, I("yes"))).reply, "I couldn't find an appointment for this number.");
  assert.ok(hasNote(await systemNotes(conv), { kind: "cancelled_in_calendar", start: "2026-10-21T13:00:00.000Z", timeZone: "America/Bahia" }));
});

test("remarcar mantém o título do evento", async () => {
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  await say(conv, I("reschedule"));
  await say(conv, I("choose", { option: 3 }));
  await say(conv, I("choose", { option: 1 }));
  await say(conv, I("yes"));
  const [event] = [...h.fake.events.values()];
  assert.equal(event.summary, "Maria — Dental Cleaning");
  assert.equal(h.fake.calls.moveEvent, 1);
});

test("remarcar com dia e parte do dia: só os horários da tarde desse dia, e a remarcação segue até mover o evento", async () => {
  // Marcado com 1 h: a remarcação usa a duração do horário atual, não a do tratamento padrão (30 min)
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  h.catalogMinutes = { "Dental Cleaning": 60 };
  const conv = await conversation();
  await book(conv);
  h.catalogMinutes = {};
  const { reply } = await say(conv, I("reschedule", { date: "2026-10-21", period: "afternoon" }));
  assert.match(reply, /^On Wednesday, October 21 I have these times:\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\n• 3:00 PM\n/);
  const s = await sessionOf(conv);
  assert.equal(s?.flow, "reschedule");
  assert.equal(s?.step, "choose_slot");
  assert.match((await say(conv, I("choose", { option: 1 }))).reply, /^Shall I move your appointment from Wednesday, October 21 at 10:00 AM to Wednesday, October 21 at 12:00 PM\?/);
  assert.equal((await say(conv, I("yes"))).reply, "Done! Your appointment is now on Wednesday, October 21 at 12:00 PM.");
  assert.equal(h.fake.calls.moveEvent, 1);
  const [appt] = await allAppointments();
  assert.equal(appt.startsAt.toISOString(), at("2026-10-21T12:00").toISOString());
  assert.equal(appt.endsAt.toISOString(), at("2026-10-21T13:00").toISOString());
});

test("remarcar com dia e horário livre vai direto à confirmação", async () => {
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  const { reply } = await say(conv, I("reschedule", { date: "2026-10-21", time: "15:00" }));
  assert.equal(reply, "Shall I move your appointment from Wednesday, October 21 at 10:00 AM to Wednesday, October 21 at 3:00 PM?");
  assert.equal((await sessionOf(conv))?.step, "confirm_reschedule");
});

test("remarcar sem dia continua oferecendo os dias", async () => {
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  assert.match((await say(conv, I("reschedule"))).reply, /^Sure! These days have openings/);
  assert.equal((await sessionOf(conv))?.step, "choose_day");
});

// Com um horário futuro, escolher um horário nunca vira agendamento novo (BR-SCH-05)

test("horário escolhido numa consulta de disponibilidade, com agendamento futuro, vai à confirmação da troca", async () => {
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  await say(conv, I("availability", { date: "2026-10-23", period: "afternoon" }));
  const { reply } = await say(conv, I("choose", { time: "15:00" }));
  assert.equal(reply, "Shall I move your appointment from Wednesday, October 21 at 10:00 AM to Friday, October 23 at 3:00 PM?");
  const s = await sessionOf(conv);
  assert.equal(s?.step, "confirm_reschedule");
  assert.equal(s?.flow, "reschedule");
  assert.equal((await say(conv, I("yes"))).reply, "Done! Your appointment is now on Friday, October 23 at 3:00 PM.");
  assert.equal(h.fake.calls.moveEvent, 1);
  const [appt] = await allAppointments();
  assert.equal(appt.startsAt.toISOString(), at("2026-10-23T15:00").toISOString());
});

test("horário escolhido com agendamento futuro dentro do prazo de cancelamento: recusa, sem mexer na agenda", async () => {
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  // Quarta às 10 h está a 19 h de agora: com prazo de 24 h, não pode mais ser mudada
  h.rules = { ...DEFAULT_RULES };
  await say(conv, I("availability", { date: "2026-10-23", period: "afternoon" }));
  const { reply } = await say(conv, I("choose", { time: "15:00" }));
  assert.equal(reply, "Your appointment is in less than 24 hours, so I can't change it here. Please contact the clinic directly.");
  assert.equal(await sessionOf(conv), null);
  assert.equal(h.fake.calls.moveEvent, 0);
  assert.equal(h.fake.calls.deleteEvent, 0);
});

test("book com dia citado e agendamento futuro: o dia e o horário vão direto à confirmação da troca", async () => {
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  const { reply } = await say(conv, I("book", { date: "2026-10-23", time: "15:00" }));
  assert.equal(reply, "Shall I move your appointment from Wednesday, October 21 at 10:00 AM to Friday, October 23 at 3:00 PM?");
  assert.equal((await sessionOf(conv))?.step, "confirm_reschedule");
});

test("book com dia citado e agendamento futuro sem horário: os horários do dia valem para a remarcação", async () => {
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation();
  await book(conv);
  const { reply } = await say(conv, I("book", { date: "2026-10-23", period: "afternoon" }));
  assert.match(reply, /^On Friday, October 23 I have these times:/);
  const s = await sessionOf(conv);
  assert.equal(s?.flow, "reschedule");
  assert.equal(s?.step, "choose_slot");
});

test("sem agendamento futuro, horário escolhido segue para o resumo de um novo agendamento", async () => {
  const conv = await conversation();
  await say(conv, I("availability", { date: "2026-10-23", period: "afternoon" }));
  await say(conv, I("choose", { time: "15:00" }));
  const s = await sessionOf(conv);
  assert.equal(s?.step, "confirm_booking");
  assert.equal(s?.flow, "book");
  assert.equal(h.fake.calls.moveEvent, 0);
});
