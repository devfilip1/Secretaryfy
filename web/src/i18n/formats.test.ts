import assert from "node:assert/strict";
import { test } from "node:test";
import { createFormats } from "./createFormats";

// 5 de março de 2026, 14:07 em UTC.
const ISO = "2026-03-05T14:07:00Z";
const SAME_DAY_NOW = () => new Date("2026-03-05T20:00:00Z");
const OTHER_DAY_NOW = () => new Date("2026-03-07T09:00:00Z");

test("en-US: mês/dia e relógio de 12 horas", () => {
  const f = createFormats("en-US", "UTC", OTHER_DAY_NOW);
  assert.equal(f.formatDay(ISO), "03/05");
  assert.equal(f.formatClock(ISO), "02:07 PM");
  assert.equal(f.formatDate(ISO), "3/5/26");
  assert.equal(f.formatDateTime(ISO), "3/5/26, 2:07 PM");
});

test("pt-BR: dia/mês e relógio de 24 horas", () => {
  const f = createFormats("pt-BR", "UTC", OTHER_DAY_NOW);
  assert.equal(f.formatDay(ISO), "05/03");
  assert.equal(f.formatClock(ISO), "14:07");
  assert.equal(f.formatDate(ISO), "05/03/2026");
  assert.equal(f.formatDateTime(ISO), "05/03/2026, 14:07");
});

test("formatTime mostra a hora se o instante é hoje e o dia nos outros dias", () => {
  assert.equal(createFormats("pt-BR", "UTC", SAME_DAY_NOW).formatTime(ISO), "14:07");
  assert.equal(createFormats("pt-BR", "UTC", OTHER_DAY_NOW).formatTime(ISO), "05/03");
  assert.equal(createFormats("en-US", "UTC", SAME_DAY_NOW).formatTime(ISO), "02:07 PM");
  assert.equal(createFormats("en-US", "UTC", OTHER_DAY_NOW).formatTime(ISO), "03/05");
});

test("o fuso da clínica decide o dia: 02:30 UTC do dia 5 é 23:30 do dia 4 em São Paulo", () => {
  const f = createFormats("pt-BR", "America/Sao_Paulo", () => new Date("2026-03-04T12:00:00-03:00"));
  const lateNight = "2026-03-05T02:30:00Z";
  assert.equal(f.formatClock(lateNight), "23:30");
  assert.equal(f.formatDay(lateNight), "04/03");
  assert.equal(f.formatTime(lateNight), "23:30");
});
