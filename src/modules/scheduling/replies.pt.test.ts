import assert from "node:assert/strict";
import { test } from "node:test";
import { testCatalog } from "../../test/catalog.js";
import { createReplies, type Replies } from "./replies.js";
import { createClinicContext } from "../clinic/context.js";
import { ASSESSMENT, createCatalog } from "./catalog.js";

const tz = "America/Bahia";
const start = new Date("2026-10-21T13:00:00Z");
const other = new Date("2026-10-23T17:00:00Z");
const slots = [new Date("2026-10-21T12:00:00Z"), new Date("2026-10-21T13:00:00Z")];

/** Uma chamada de cada método de Replies, com argumentos válidos (startsWithAgain devolve boolean: testado à parte). */
function everyCall(r: Replies): Record<Exclude<keyof Replies, "startsWithAgain">, () => string | string[]> {
  return {
    servicesList: () => r.servicesList(),
    offerDays: () => r.offerDays(["2026-10-21", "2026-10-22"], tz),
    offerSlots: () => r.offerSlots("2026-10-21", slots, tz, true),
    periodEmpty: () => r.periodEmpty("2026-10-21", "morning", slots, tz, true),
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
    nameKept: () => r.nameKept("Maria"),
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

const pt = createReplies({ clinic: { name: "Clínica Sorriso", language: "pt" }, catalog: testCatalog });

test("lista de serviços em português: todos os tratamentos do catálogo e a avaliação geral no fim", () => {
  const lines = pt.servicesList().split("\n");
  assert.equal(lines[0], "Oferecemos estes serviços:");
  assert.equal(lines.at(-2), "• Avaliação geral");
  assert.equal(lines.at(-1), "Quer marcar algum deles? É só me dizer qual.");
  assert.equal(lines.length, testCatalog.list().length + 2);
});

test("startsWithAgain reconhece a abertura da resposta repetida, não qualquer texto", () => {
  assert.equal(pt.startsWithAgain("Claro! Tenho horários"), true);
  assert.equal(pt.startsWithAgain("Tenho horários"), false);
});

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
  assert.match(pt.chooseService(), /\n• Dental Cleaning\n/);
  assert.match(pt.chooseService(), /\n• Não tenho certeza \(avaliação geral\)\n/);
});

test("retorno ligado em pt: a lista mostra Retorno, não o rótulo em inglês", () => {
  const clinic = createClinicContext({ name: "Clínica Sorriso", kind: "dental clinic", language: "pt", offerAssessment: false, offerFollowUp: true });
  const catalog = createCatalog(testCatalog.list().filter((s) => s.name !== ASSESSMENT), clinic);
  const list = createReplies({ clinic, catalog }).chooseService();
  assert.match(list, /\n• Retorno\n/);
  assert.doesNotMatch(list, /Follow-up visit/);
});

test("confirmação e lembrete pedem confirmação", () => {
  assert.match(pt.confirmBooking(start, 60, "Maria", "Dental Cleaning", tz), /Posso confirmar\?/);
  assert.match(pt.confirmBooking(start, 60, "Maria", "Dental Cleaning", tz), /🦷 Dental Cleaning/);
  for (const text of pt.reminder(start, "Dental Cleaning", "Maria", tz)) assert.match(text, /confirma/i);
});

test("clínica em inglês continua com o nome configurado", () => {
  const en = createReplies({ clinic: { name: "Smile Clinic", language: "en" }, catalog: testCatalog });
  assert.equal(en.booked(start, tz), "You're booked! 📅 Wednesday, October 21 at 10:00 AM. See you at Smile Clinic.");
});

test("horas de antecedência em pt", () => {
  assert.match(pt.tooLateToChange(1440), /menos de 24 horas/);
  assert.match(pt.tooLateToChange(60), /menos de 1 hora/);
  assert.match(pt.tooLateToChange(90), /menos de 90 minutos/);
});

test("o dia na frase leva o artigo certo: na quarta-feira, no sábado", () => {
  const r = createReplies({ clinic: { name: "Sorriso Pleno", language: "pt" }, catalog: testCatalog });
  assert.ok(r.offerSlots("2026-10-21", slots, tz, false).startsWith("Na quarta-feira, 21 de outubro, tenho estes horários:\n• 09:00\n• 10:00\n"));
  assert.match(r.slotTaken("2026-10-24", slots, tz), /mais próximos no sábado, 24 de outubro são:/);
  assert.match(r.closedDay([6, 7], ["2026-10-26"], tz), /^Não atendemos sábado e domingo\./);
  assert.match(r.closedDay([1, 3, 7], ["2026-10-27"], tz), /^Não atendemos segunda, quarta e domingo\./);
});

test("fim de semana: domingo fechado diz que atende aos sábados e lista as datas; os dois abertos dizem que atende aos dois", () => {
  assert.equal(
    pt.weekendOpen(["2026-11-14", "2026-11-21"], [7], tz),
    "Atendemos aos sábados. Aos domingos estamos fechados. Estes são os próximos sábados com horário livre:\n• sábado, 14 de novembro\n• sábado, 21 de novembro\nQual deles fica melhor para você?",
  );
  assert.equal(
    pt.weekendOpen(["2026-11-14", "2026-11-15"], [], tz),
    "Atendemos aos sábados e domingos. Estes são os próximos dias com horário livre:\n• sábado, 14 de novembro\n• domingo, 15 de novembro\nQual deles fica melhor para você?",
  );
});

test("parte do dia sem horário livre: diz a parte e oferece os outros horários do dia", () => {
  assert.equal(
    pt.periodEmpty("2026-10-21", "morning", slots, tz, false),
    "Não tenho horário livre de manhã na quarta-feira, 21 de outubro, mas tenho estes:\n• 09:00\n• 10:00\nQual prefere? Se preferir outro dia, é só pedir.",
  );
  assert.match(pt.periodEmpty("2026-10-21", "afternoon", slots, tz, true), /^Não tenho horário livre à tarde na quarta-feira, 21 de outubro, mas tenho estes:/);
  assert.match(pt.periodEmpty("2026-10-21", "evening", slots, tz, true), /Se quiser ver mais horários ou outro dia, é só pedir\.$/);
  assert.match(pt.periodEmpty("2026-10-21", "evening", slots, tz, true), /horário livre à noite/);
});

test("com o nome do cliente, as respostas o chamam pelo primeiro nome", () => {
  const r = createReplies({ clinic: { name: "Sorriso Pleno", language: "pt" }, catalog: testCatalog });
  assert.match(r.booked(start, tz, "Paulo Lima"), /^Tudo certo, Paulo, seu horário está marcado!/);
  assert.match(r.booked(start, tz), /^Tudo certo, seu horário está marcado!/);
  assert.match(r.chooseService("Paulo Lima"), /^Paulo, para qual serviço é este agendamento\?/);
  assert.match(r.goodbye(() => 0, "Paulo Lima"), /^De nada, Paulo!/);
});

test("nameReceived usa só o primeiro nome", () => {
  const r = createReplies({ clinic: { name: "Sorriso Pleno", language: "pt" }, catalog: testCatalog });
  assert.match(r.nameReceived("Carla Souza", () => 0), /^Prazer, Carla! /);
});

test("a saudação segue o período do dia, e de madrugada ainda é noite", () => {
  const r = createReplies({ clinic: { name: "Sorriso Pleno", language: "pt" }, catalog: testCatalog });
  assert.deepEqual([1, 8, 14, 20].map((h) => r.greeting(h).split("!")[0]), ["Boa noite", "Bom dia", "Boa tarde", "Boa noite"]);
});

test("o mesmo Replies troca de língua quando a clínica troca: inglês, depois português", () => {
  const clinic = createClinicContext({ name: "Smile Clinic", kind: "dental clinic", language: "en" });
  const r = createReplies({ clinic, catalog: testCatalog });
  assert.equal(r.booked(start, tz), "You're booked! 📅 Wednesday, October 21 at 10:00 AM. See you at Smile Clinic.");
  clinic.update({ language: "pt", name: "Clínica Sorriso" });
  assert.match(r.booked(start, tz), /^Tudo certo, seu horário está marcado! .* Até lá, na Clínica Sorriso\.$/);
});
