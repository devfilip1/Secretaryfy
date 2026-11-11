import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES } from "../rules.js";
import { useFlowHarness } from "../../../test/flow-harness.js";

const h = useFlowHarness();
const { say, conversation, I, sessionOf, allAppointments, allCustomers, book, pickSlot } = h;

// --- specs/005, US1: o nome do agendamento é o nome dito, nunca o do perfil ---

test("com o nome conhecido, o horário escolhido vai direto ao resumo com esse nome", async () => {
  const conv = await conversation("5571999999999", "Maria");
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  const r = await say(conv, I("choose", { option: 2 }));
  assert.match(r.reply, /👤 Maria/);
  assert.equal((await sessionOf(conv))?.step, "confirm_booking");
});

test("sem nome dito, pede o nome mesmo com o nome do perfil, e o nome dado vai para a conversa e o evento", async () => {
  const conv = await conversation("5571999999999", null);
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  const ask = await say(conv, I("choose", { option: 2 }));
  assert.match(ask.reply, /What name should I put/);
  assert.equal((await sessionOf(conv))?.step, "ask_name");

  const summary = await say(conv, I("give_name", { name: "Ana Lima" }));
  assert.match(summary.reply, /👤 Ana Lima/);
  assert.equal((await h.repo.findConversation(conv.id))?.customerName, "Ana Lima");

  await say(conv, I("yes"));
  const [appt] = await allAppointments();
  assert.equal(appt.customerName, "Ana Lima");
  assert.match([...h.fake.events.values()][0].summary, /Ana Lima/);
});

test("no resumo, 'my name is' corrige o nome", async () => {
  const conv = await conversation("5571999999999", "Maria");
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("choose", { option: 2 }));
  const r = await say(conv, I("give_name", { name: "Mariana" }));
  assert.match(r.reply, /👤 Mariana/);
  assert.equal((await sessionOf(conv))?.step, "confirm_booking");
});

// --- specs/005, US2: serviço do agendamento ---


test("sem tratamento na conversa: o tratamento vem antes dos dias; o número escolhe o serviço", async () => {
  h.mentioned = null;
  const conv = await conversation();
  const list = await say(conv, I("book"));
  assert.match(list.reply, /^Maria, which service is this appointment for\?/);
  assert.equal((await sessionOf(conv))?.step, "choose_service");
  assert.equal((await sessionOf(conv))?.options.length, 9);

  const days = await say(conv, I("choose_service", { service: "Teeth Whitening" }));
  assert.match(days.reply, /days/i);
  assert.equal((await sessionOf(conv))?.step, "choose_day");
  await say(conv, I("choose", { option: 2 }));
  const summary = await say(conv, I("choose", { option: 2 }));
  assert.match(summary.reply, /👤 Maria\n🦷 Teeth Whitening/);
  assert.equal((await sessionOf(conv))?.step, "confirm_booking");
});

test("'não sei': avaliação geral no resumo e no evento, com o rótulo do catálogo", async () => {
  h.mentioned = null;
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose_service", { service: "Assessment" }));
  await say(conv, I("choose", { option: 2 }));
  const summary = await say(conv, I("choose", { option: 2 }));
  assert.match(summary.reply, /🦷 General assessment/);
  await say(conv, I("yes"));
  assert.equal([...h.fake.events.values()][0].summary, "Maria — General assessment");
});

test("sem nome e sem serviço: serviço, dias e horário, depois o nome e o resumo", async () => {
  h.mentioned = null;
  const conv = await conversation("5571999999999", null);
  assert.match((await say(conv, I("book"))).reply, /Which service/);
  await say(conv, I("choose_service", { service: "Dental Veneers" }));
  await say(conv, I("choose", { option: 2 }));
  assert.match((await say(conv, I("choose", { option: 2 }))).reply, /What name should I put/);
  assert.match((await say(conv, I("give_name", { name: "Ana" }))).reply, /👤 Ana\n🦷 Dental Veneers/);
});

test("'não entendi' na lista de serviços repete a lista; o segundo seguido passa para o operador", async () => {
  h.mentioned = null;
  const conv = await conversation();
  await say(conv, I("book"));
  assert.match((await say(conv, I("unclear"))).reply, /^Sorry, I didn't get that\. Which service/);
  assert.equal((await say(conv, I("unclear"))).handoff, true);
});

test("horário citado e livre na grade de 15 min: vai direto para o resumo", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  const summary = await say(conv, I("choose", { time: "10:15" }));
  assert.match(summary.reply, /10:15 AM/);
  assert.equal((await sessionOf(conv))?.step, "confirm_booking");
});

test("horário citado e ocupado: avisa e oferece os três mais próximos, sem mostrar o dia inteiro", async () => {
  const first = await conversation("5571888888888", "Bia");
  await book(first); // dia 2, 10:00 a 11:00
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  const reply = await say(conv, I("choose", { time: "10:30" }));
  assert.match(reply.reply, /Unfortunately we do not have that time/);
  const session = await sessionOf(conv);
  assert.equal(session?.step, "choose_slot");
  assert.equal(session?.options.length, 3);
});

test("um tratamento de 30 min ocupa só 30 min: o horário seguinte fica livre", async () => {
  h.catalogMinutes = { "Dental Cleaning": 30 };
  const first = await conversation("5571888888888", "Bia");
  await book(first); // 10:00 a 10:30
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  const summary = await say(conv, I("choose", { time: "10:30" }));
  assert.match(summary.reply, /10:30 AM \(30 min\)/);
});

test("trocar o serviço no resumo mostra o resumo de novo e não cria nada", async () => {
  const conv = await conversation();
  assert.match((await pickSlot(conv)).reply, /🦷 Dental Cleaning/);
  const again = await say(conv, I("choose_service", { service: "Teeth Whitening" }));
  assert.match(again.reply, /🦷 Teeth Whitening/);
  assert.equal(h.fake.calls.createEvent, 0);
  await say(conv, I("yes"));
  assert.equal([...h.fake.events.values()][0].summary, "Maria — Teeth Whitening");
});

// --- specs/005, US3: cadastro de clientes ---


test("confirmar um horário inclui o cliente no cadastro e liga o agendamento a ele", async () => {
  const conv = await conversation("5571999999999", "Maria");
  await book(conv);
  const [customer] = await allCustomers();
  assert.equal(customer.name, "Maria");
  assert.equal(customer.phone, "5571999999999");
  const [appt] = await allAppointments();
  assert.equal(appt.customerId, customer.id);
});

test("marcar de novo pelo mesmo número não cria outro cliente e fica com o nome mais recente", async () => {
  h.rules = { ...DEFAULT_RULES, cancelNoticeMinutes: 60 };
  const conv = await conversation("5571999999999", "Maria");
  await book(conv);
  await say(conv, I("cancel"));
  await say(conv, I("yes"));
  await h.repo.setCustomerName(conv.id, "Maria Souza");
  await book(conv, 3, 1);
  const list = await allCustomers();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Maria Souza");
});

test("desistir, horário tomado ou falha na agenda não incluem ninguém no cadastro", async () => {
  const conv = await conversation("5571999999999", "Maria");
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("no"));
  await say(conv, I("stop"));

  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  await say(conv, I("choose", { option: 2 }));
  h.fake.failNext();
  await say(conv, I("yes"));
  assert.equal((await allCustomers()).length, 0);
  assert.equal((await allAppointments()).length, 0);
});

test("falha ao gravar o cliente não desfaz a marcação", async () => {
  h.failUpsert = true;
  const conv = await conversation("5571999999999", "Maria");
  const done = await book(conv);
  assert.match(done.reply, /^You're booked, /);
  const [appt] = await allAppointments();
  assert.equal(appt.status, "booked");
  assert.equal(appt.customerId, null);
  assert.equal(h.fake.events.size, 1);
});

test("o modelo escolheu a opção mais próxima, mas o horário citado manda", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  await say(conv, I("choose", { option: 2 }));
  const summary = await say(conv, I("choose", { option: 2, time: "10:15" }));
  assert.match(summary.reply, /10:15 AM/);
});
