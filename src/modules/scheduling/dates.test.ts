import assert from "node:assert/strict";
import { test } from "node:test";
import { findDatesInText, formatDay, formatPtBr, formatTime, parseSimpleDate, parseTimeOfDay } from "./dates.js";

const timeZone = "America/Bahia";
// Terça-feira, 20/10/2026, 15:00 em Salvador (UTC-3)
const now = new Date("2026-10-20T18:00:00Z");
const parse = (text: string, at = now) => parseSimpleDate(text, { now: at, timeZone });

test("today e tomorrow", () => {
  assert.equal(parse("today"), "2026-10-20");
  assert.equal(parse("Tomorrow"), "2026-10-21");
  assert.equal(parse("tomorrow please!"), "2026-10-21");
});

test("dia da semana é o próximo a partir de hoje; next <dia> é o da semana seguinte", () => {
  assert.equal(parse("friday"), "2026-10-23");
  assert.equal(parse("on Fri"), "2026-10-23");
  assert.equal(parse("tuesday"), "2026-10-20");
  assert.equal(parse("monday"), "2026-10-26");
  assert.equal(parse("next friday"), "2026-10-30");
  assert.equal(parse("next monday"), "2026-10-26");
  // Numa segunda, "monday" é hoje
  assert.equal(parse("monday", new Date("2026-10-19T12:00:00Z")), "2026-10-19");
});

test("datas numéricas e com o nome do mês", () => {
  assert.equal(parse("23/10"), "2026-10-23");
  assert.equal(parse("Oct 23"), "2026-10-23");
  assert.equal(parse("23 Oct"), "2026-10-23");
  assert.equal(parse("October 23rd"), "2026-10-23");
  assert.equal(parse("5/1"), "2027-01-05");
  assert.equal(parse("15/10"), "2027-10-15");
  assert.equal(parse("24/12/2026"), "2026-12-24");
});

test("o que não é uma data simples devolve null", () => {
  assert.equal(parse("31/02"), null);
  assert.equal(parse("banana"), null);
  assert.equal(parse("2"), null);
  assert.equal(parse("can I come friday afternoon?"), null);
  assert.equal(parse("20/10/2025"), null);
});

test("formatação no fuso da clínica", () => {
  const at = new Date("2026-10-21T13:00:00Z"); // 10:00 em Salvador
  assert.equal(formatDay(at, timeZone), "Wed, Oct 21");
  assert.equal(formatTime(at, timeZone), "10:00 AM");
  assert.equal(formatTime(new Date("2026-10-21T17:30:00Z"), timeZone), "2:30 PM");
  assert.equal(formatPtBr(at, timeZone), "qua, 21/10 às 10:00");
});

test("datas citadas no meio da frase", () => {
  const ctx = { now, timeZone };
  assert.deepEqual(findDatesInText("Do you have openings on Sunday?", ctx), ["2026-10-25"]);
  assert.deepEqual(findDatesInText("Can I book a visit for tomorrow?", ctx), ["2026-10-21"]);
  assert.deepEqual(findDatesInText("what about next friday, the 30/10?", ctx), ["2026-10-30"]);
  assert.deepEqual(findDatesInText("monday or tuesday", ctx).length, 2);
  assert.deepEqual(findDatesInText("May I come in next week?", ctx), []);
});

test("horário citado em minutos desde a meia-noite", () => {
  assert.equal(parseTimeOfDay("the 10 am one"), 600);
  assert.equal(parseTimeOfDay("2:30 p.m. please"), 870);
  assert.equal(parseTimeOfDay("at 14:00"), 840);
  assert.equal(parseTimeOfDay("12pm"), 720);
  assert.equal(parseTimeOfDay("12 am"), 0);
  assert.equal(parseTimeOfDay("13 pm"), null);
  assert.equal(parseTimeOfDay("2"), null);
});
