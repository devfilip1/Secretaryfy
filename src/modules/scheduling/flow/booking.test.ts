import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { CalendarUnavailable } from "../../google/gateway.js";
import { at, useFlowHarness } from "../../../test/flow-harness.js";

const h = useFlowHarness();
const { say, conversation, I, sessionOf, systemTexts, allAppointments, book } = h;

// --- US1: marcar ---

test("marcar: confirmação com dia, hora, duração e nome; yes cria o evento e o agendamento", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  const confirm = await say(conv, I("choose", { option: 2 }));
  assert.equal(
    confirm.reply,
    "Just to confirm:\n📅 Wednesday, October 21 at 10:00 AM (60 min)\n👤 Maria\n🦷 Dental Cleaning\nShall I confirm? If anything is wrong, like the name, the time or the service, just tell me.",
  );

  const done = await say(conv, I("yes"));
  assert.equal(done.reply, "You're booked, Maria! 📅 Wednesday, October 21 at 10:00 AM. See you at DentalSafe.");
  assert.equal(h.fake.calls.createEvent, 1);
  const [event] = [...h.fake.events.values()];
  // specs/005: "<nome> — <serviço>"
  assert.equal(event.summary, "Maria — Dental Cleaning");
  assert.equal(event.description, "WhatsApp: +5571999999999\nServiço: Dental Cleaning\nMarcado pelo Secretaryfy.");
  assert.equal(event.end.getTime() - event.start.getTime(), 60 * 60_000);
  const [appt] = await allAppointments();
  assert.equal(appt.status, "booked");
  assert.equal(appt.startsAt.toISOString(), at("2026-10-21T10:00").toISOString());
  assert.equal(event.properties.secretaryfy_appointment, appt.id);
  assert.equal(await sessionOf(conv), null);
  // US4: registro no histórico
  assert.deepEqual(await systemTexts(conv), ["Booked by the assistant: Wed, Oct 21 at 10:00 AM (60 min), Dental Cleaning"]);
  assert.equal(appt.service, "Dental Cleaning");
});

test("sem nome no WhatsApp, pergunta o nome antes de confirmar", async () => {
  const conv = await conversation("5571888888888", null);
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  assert.equal((await say(conv, I("choose", { option: 1 }))).reply, "What name should I put on the appointment?");
  const confirm = await say(conv, I("give_name", { name: "João" }));
  assert.match(confirm.reply, /👤 João/);
});

test("no na confirmação não cria nada e volta para os horários do dia", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("choose", { option: 2 }));
  const { reply } = await say(conv, I("no"));
  assert.match(reply, /^On Wednesday, October 21 I have these times:/);
  assert.equal(h.fake.calls.createEvent, 0);
  assert.equal((await sessionOf(conv))?.step, "choose_slot");
});

test("horário ocupado entre a oferta e o yes: slot_taken, sem evento (FR-015)", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("choose", { option: 2 }));
  h.fake.block(at("2026-10-21T10:00"), at("2026-10-21T11:00"));
  const { reply } = await say(conv, I("yes"));
  assert.match(reply, /^Sorry, that time was just taken\. The closest available times on Wednesday, October 21 are:\n• 9:00 AM\n• 11:00 AM/);
  assert.equal(h.fake.calls.createEvent, 0);
  assert.equal((await allAppointments()).length, 0);
});

test("dois clientes confirmando o mesmo horário ao mesmo tempo: só um fica com ele (SC-003)", async () => {
  const a = await conversation("5571111111111", "Ana");
  const b = await conversation("5571222222222", "Bia");
  for (const c of [a, b]) {
    await say(c, I("book"));
    await say(c, I("choose", { option: 2 }));
    await say(c, I("choose", { option: 2 }));
  }
  const results = await Promise.all([say(a, I("yes")), say(b, I("yes"))]);
  assert.equal(results.filter((r) => r.reply.startsWith("You're booked")).length, 1);
  assert.equal(results.filter((r) => r.reply.startsWith("Sorry, that time was just taken")).length, 1);
  assert.equal(h.fake.events.size, 1);
  assert.equal((await allAppointments()).length, 1);
});

test("falha ao criar o evento: calendar_unavailable e nada marcado (FR-024)", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("choose", { option: 2 }));
  // getEvent não é chamado (sem agendamento), busy passa, createEvent falha
  const original = h.fake.gateway.createEvent;
  h.fake.gateway.createEvent = async () => {
    throw new CalendarUnavailable("fora");
  };
  const { reply } = await say(conv, I("yes"));
  h.fake.gateway.createEvent = original;
  assert.match(reply, /can't book appointments right now/);
  assert.equal((await allAppointments()).length, 0);
});

test("um horário futuro por número; evento apagado no Google libera para marcar de novo (FR-019, FR-018a)", async () => {
  const conv = await conversation();
  await book(conv);
  const again = await say(conv, I("book"));
  assert.equal(again.reply, "You already have an appointment on Wednesday, October 21 at 10:00 AM. Would you like to reschedule it?");
  assert.equal((await sessionOf(conv))?.step, "offer_reschedule");

  h.fake.events.clear();
  const fresh = await say(conv, I("book"));
  assert.match(fresh.reply, /^Sure! These days have openings/);
  const [appt] = await allAppointments();
  assert.equal(appt.status, "cancelled");
  assert.equal(appt.cancelledBy, "calendar");
  assert.ok((await systemTexts(conv)).includes("Cancelled in the calendar: Wed, Oct 21 at 10:00 AM"));
});

test("o horário é do telefone: sobrevive à limpeza das conversas e vale numa conversa nova (specs/006 R1)", async () => {
  const conv = await conversation();
  await book(conv);
  await h.repo.deleteAllConversations();

  const fresh = await conversation();
  assert.notEqual(fresh.id, conv.id);
  assert.equal((await say(fresh, I("my_appointment"))).reply, "Your appointment is on Wednesday, October 21 at 10:00 AM.");
  assert.match((await say(fresh, I("book"))).reply, /^You already have an appointment on Wednesday, October 21 at 10:00 AM/);
  const [appt] = await allAppointments();
  assert.deepEqual([appt.conversationId, appt.phone, appt.origin], [null, "5571999999999", "assistant"]);
});

test("lembrete inicial: pendente com 24 h ou mais de antecedência; remarcar recalcula (specs/006 FR-020, FR-025)", async () => {
  const conv = await conversation();
  // Quarta 10h: 19 h à frente
  await book(conv);
  assert.equal((await allAppointments())[0].reminderStatus, "not_needed");

  await h.testDb.db.execute(sql`delete from appointments`);
  h.fake.events.clear();
  // Quinta: mais de 24 h à frente
  await book(conv, 3, 2);
  assert.equal((await allAppointments())[0].reminderStatus, "pending");
});
