import assert from "node:assert/strict";
import { test } from "node:test";
import type { WeeklyHours } from "../../db/schema.js";
import { CLINIC_HOURS } from "../../test/hours.js";
import { hoursLines } from "./hours.js";

test("pt: weekdays with the same hours become one line, the closed day its own", () => {
  assert.deepEqual(hoursLines(CLINIC_HOURS, "pt"), ["Segunda a sexta: 9h às 18h", "Sábado: 9h às 14h", "Domingo: Fechado"]);
});

test("en: the same rows, with the English day names, the time format of the brochure and \"Closed\"", () => {
  assert.deepEqual(hoursLines(CLINIC_HOURS, "en"), ["Monday–Friday: 9:00 AM–6:00 PM", "Saturday: 9:00 AM–2:00 PM", "Sunday: Closed"]);
});

test("a clinic closed on Wednesday gets the closed day in the middle, and the groups around it", () => {
  const closedWednesday: WeeklyHours = {
    "1": { start: "09:00", end: "18:00" },
    "2": { start: "09:00", end: "18:00" },
    "4": { start: "09:00", end: "18:00" },
    "5": { start: "09:00", end: "18:00" },
    "6": { start: "09:00", end: "18:00" },
  };
  assert.deepEqual(hoursLines(closedWednesday, "pt"), [
    "Segunda a terça: 9h às 18h",
    "Quarta: Fechado",
    "Quinta a sábado: 9h às 18h",
    "Domingo: Fechado",
  ]);
  assert.deepEqual(hoursLines(closedWednesday, "en"), [
    "Monday–Tuesday: 9:00 AM–6:00 PM",
    "Wednesday: Closed",
    "Thursday–Saturday: 9:00 AM–6:00 PM",
    "Sunday: Closed",
  ]);
});

test("a day with different hours breaks the group, and half hours show their minutes", () => {
  const uneven: WeeklyHours = {
    "1": { start: "08:00", end: "12:00" },
    "2": { start: "08:00", end: "12:00" },
    "3": { start: "09:30", end: "18:00" },
  };
  assert.deepEqual(hoursLines(uneven, "pt"), ["Segunda a terça: 8h às 12h", "Quarta: 9h30 às 18h", "Quinta a domingo: Fechado"]);
  assert.deepEqual(hoursLines(uneven, "en"), [
    "Monday–Tuesday: 8:00 AM–12:00 PM",
    "Wednesday: 9:30 AM–6:00 PM",
    "Thursday–Sunday: Closed",
  ]);
});

test("no open day at all is one closed line for the whole week", () => {
  assert.deepEqual(hoursLines({}, "pt"), ["Segunda a domingo: Fechado"]);
  assert.deepEqual(hoursLines({}, "en"), ["Monday–Sunday: Closed"]);
});
