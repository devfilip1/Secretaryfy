import assert from "node:assert/strict";
import { test } from "node:test";
import { availableDays, bookingWindow, slotsForDay } from "./availability.js";
import { DEFAULT_RULES, type Rules } from "./rules.js";

const timeZone = "America/Bahia";
// Terça, 20/10/2026, 15:00 em Salvador
const now = new Date("2026-10-20T18:00:00Z");
const at = (local: string) => new Date(`${local}-03:00`);
const times = (slots: Date[]) => slots.map((s) => s.toISOString());
const rules = (patch: Partial<Rules> = {}): Rules => ({ ...DEFAULT_RULES, ...patch });

test("horários do dia: do início ao fim, no passo da duração", () => {
  const slots = slotsForDay("2026-10-21", { rules: rules(), busy: [], now, timeZone });
  assert.equal(slots.length, 9);
  assert.equal(slots[0].toISOString(), at("2026-10-21T09:00").toISOString());
  assert.equal(slots.at(-1)!.toISOString(), at("2026-10-21T17:00").toISOString());

  const half = slotsForDay("2026-10-21", {
    rules: rules({ slotMinutes: 45, weeklyHours: { "3": { start: "09:00", end: "11:00" } } }),
    busy: [],
    now,
    timeZone,
  });
  // 9:00, 9:45 (10:30 não cabe até 11:00)
  assert.deepEqual(times(half), [at("2026-10-21T09:00").toISOString(), at("2026-10-21T09:45").toISOString()]);
});

test("antecedência mínima corta os primeiros horários de hoje", () => {
  // Agora 15:00 + 2 h: o primeiro horário possível é 17:00
  const today = slotsForDay("2026-10-20", { rules: rules(), busy: [], now, timeZone });
  assert.deepEqual(times(today), [at("2026-10-20T17:00").toISOString()]);
  const none = slotsForDay("2026-10-20", { rules: rules({ minNoticeMinutes: 180 }), busy: [], now, timeZone });
  assert.deepEqual(none, []);
});

test("horários ocupados saem, inclusive por sobreposição parcial", () => {
  const busy = [
    { start: at("2026-10-21T10:00"), end: at("2026-10-21T12:00") },
    { start: at("2026-10-21T14:30"), end: at("2026-10-21T14:45") },
  ];
  const slots = slotsForDay("2026-10-21", { rules: rules(), busy, now, timeZone });
  const hours = slots.map((s) => s.toISOString());
  assert.ok(!hours.includes(at("2026-10-21T10:00").toISOString()));
  assert.ok(!hours.includes(at("2026-10-21T11:00").toISOString()));
  assert.ok(!hours.includes(at("2026-10-21T14:00").toISOString()));
  assert.ok(hours.includes(at("2026-10-21T12:00").toISOString()));
  assert.ok(hours.includes(at("2026-10-21T15:00").toISOString()));
  assert.equal(slots.length, 6);
});

test("evento de dia inteiro remove o dia; dia sem atendimento não tem horários", () => {
  const allDay = [{ start: at("2026-10-21T00:00"), end: at("2026-10-22T00:00") }];
  assert.deepEqual(slotsForDay("2026-10-21", { rules: rules(), busy: allDay, now, timeZone }), []);
  // 25/10/2026 é domingo
  assert.deepEqual(slotsForDay("2026-10-25", { rules: rules(), busy: [], now, timeZone }), []);
});

test("janela de agendamento: de hoje até maxDaysAhead", () => {
  const w = bookingWindow({ rules: rules({ maxDaysAhead: 10 }), now, timeZone });
  assert.equal(w.firstDate, "2026-10-20");
  assert.equal(w.lastDate, "2026-10-30");
  assert.equal(w.to.toISOString(), at("2026-10-31T00:00").toISOString());
  // Fora da janela não há horários
  assert.deepEqual(slotsForDay("2026-11-02", { rules: rules({ maxDaysAhead: 10 }), busy: [], now, timeZone }), []);
});

test("availableDays: só dias com ao menos um horário livre, em ordem, a partir de hoje", () => {
  const busy = [{ start: at("2026-10-21T00:00"), end: at("2026-10-22T00:00") }];
  const days = availableDays({ rules: rules({ maxDaysAhead: 7 }), busy, now, timeZone });
  // 20 (17:00 ainda livre), 22, 23, 26, 27 — 21 ocupado, 24 e 25 fim de semana
  assert.deepEqual(days, ["2026-10-20", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"]);
  assert.deepEqual(availableDays({ rules: rules({ maxDaysAhead: 7 }), busy, now, timeZone, after: "2026-10-22" }), [
    "2026-10-23",
    "2026-10-26",
    "2026-10-27",
  ]);
});

test("troca de horário de verão não duplica nem pula horários", () => {
  // Em São Paulo, 04/11/2018 à meia-noite o relógio pulou para 01:00
  const dstRules = rules({ weeklyHours: { "7": { start: "00:00", end: "06:00" } }, minNoticeMinutes: 0, maxDaysAhead: 30 });
  const slots = slotsForDay("2018-11-04", {
    rules: dstRules,
    busy: [],
    now: new Date("2018-11-01T12:00:00Z"),
    timeZone: "America/Sao_Paulo",
  });
  const ms = slots.map((s) => s.getTime());
  assert.equal(new Set(ms).size, ms.length);
  for (let i = 1; i < ms.length; i++) assert.equal(ms[i] - ms[i - 1], 60 * 60_000);
  assert.ok(slots.length >= 5);
});
