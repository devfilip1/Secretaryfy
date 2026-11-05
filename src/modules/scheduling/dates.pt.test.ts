import assert from "node:assert/strict";
import { test } from "node:test";
import { findDatesInText, formatDay, formatDayTime, formatTime, parseSimpleDate, parseTimeOfDay } from "./dates.js";

const timeZone = "America/Bahia";
// Terça-feira, 20/10/2026, 15:00 em Salvador (UTC-3)
const now = new Date("2026-10-20T18:00:00Z");
const at = new Date("2026-11-06T13:30:00Z");

test("formatação em português: dia, hora de 24 h e 'às'", () => {
  assert.equal(formatDay(at, timeZone, "pt"), "sex., 6 de nov.");
  assert.equal(formatTime(at, timeZone, "pt"), "10:30");
  assert.equal(formatDayTime(at, timeZone, "pt"), "sex., 6 de nov. às 10:30");
  // Inglês continua igual
  assert.equal(formatDayTime(at, timeZone), "Fri, Nov 6 at 10:30 AM");
});

test("hoje, amanhã e depois de amanhã", () => {
  assert.equal(parseSimpleDate("hoje", { now, timeZone }), "2026-10-20");
  assert.equal(parseSimpleDate("amanhã", { now, timeZone }), "2026-10-21");
  assert.equal(parseSimpleDate("amanha", { now, timeZone }), "2026-10-21");
  assert.equal(parseSimpleDate("depois de amanhã", { now, timeZone }), "2026-10-22");
});

test("dias da semana em português, com e sem acento ou '-feira'", () => {
  assert.equal(parseSimpleDate("sábado", { now, timeZone }), "2026-10-24");
  assert.equal(parseSimpleDate("sabado", { now, timeZone }), "2026-10-24");
  assert.equal(parseSimpleDate("segunda-feira", { now, timeZone }), "2026-10-26");
  assert.equal(parseSimpleDate("próxima terça", { now, timeZone }), "2026-10-27");
});

test("dia 25, 25/11 e 25 de novembro", () => {
  assert.equal(parseSimpleDate("dia 25", { now, timeZone }), "2026-10-25");
  assert.equal(parseSimpleDate("25/11", { now, timeZone }), "2026-11-25");
  assert.equal(parseSimpleDate("25 de novembro", { now, timeZone }), "2026-11-25");
});

test("horários em português: 14h, 14h30, às 10", () => {
  assert.equal(parseTimeOfDay("14h"), 14 * 60);
  assert.equal(parseTimeOfDay("14h30"), 14 * 60 + 30);
  assert.equal(parseTimeOfDay("às 10"), 10 * 60);
  assert.equal(parseTimeOfDay("14:30"), 14 * 60 + 30);
  assert.equal(parseTimeOfDay("sem horário"), null);
});

test("datas citadas no meio da frase em português", () => {
  assert.deepEqual(findDatesInText("tem horário no sábado de manhã?", { now, timeZone }), ["2026-10-24"]);
  assert.deepEqual(findDatesInText("depois de amanhã às 14h", { now, timeZone }), ["2026-10-22"]);
});

test("dia da semana no plural vale como no singular: 'aos sábados', 'on Saturdays'", () => {
  assert.deepEqual(findDatesInText("vocês atendem aos sábados?", { now, timeZone }), ["2026-10-24"]);
  assert.deepEqual(findDatesInText("do you open on Saturdays?", { now, timeZone }), ["2026-10-24"]);
  assert.equal(parseSimpleDate("sábados", { now, timeZone }), "2026-10-24");
});
