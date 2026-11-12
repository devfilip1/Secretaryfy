import assert from "node:assert/strict";
import { test } from "node:test";
import { DateTime } from "luxon";
import { slotsInPeriod, slotsNearPeriod } from "./period.js";

const tz = "America/Bahia";
/** Horários cheios de 19/11/2026 em Salvador (UTC-3) */
const hours = (...h: number[]) => h.map((x) => DateTime.fromISO(`2026-11-19T${String(x).padStart(2, "0")}:00`, { zone: tz }).toJSDate());
/** Os horários como "HH:mm" da clínica, para ler o teste */
const shown = (dates: Date[]) => dates.map((d) => DateTime.fromJSDate(d, { zone: tz }).toFormat("HH:mm"));

test("slotsInPeriod: separa a manhã, a tarde e a noite, na ordem em que vieram", () => {
  const slots = hours(9, 11, 12, 15, 17, 18);
  assert.deepEqual(shown(slotsInPeriod(slots, "morning", tz)), ["09:00", "11:00"]);
  assert.deepEqual(shown(slotsInPeriod(slots, "afternoon", tz)), ["12:00", "15:00", "17:00"]);
  assert.deepEqual(shown(slotsInPeriod(slots, "evening", tz)), ["18:00"]);
});

test("slotsInPeriod: sem horário na parte pedida, lista vazia", () => {
  assert.deepEqual(slotsInPeriod(hours(9, 10), "evening", tz), []);
});

test("slotsNearPeriod: com horários depois do início da parte, mostra os primeiros deles", () => {
  // Tarde sem horário, noite com horários: a noite é a mais próxima que vem depois
  const near = slotsNearPeriod(hours(9, 10, 18, 19), "afternoon", tz, 6);
  assert.deepEqual(shown(near.shown), ["18:00", "19:00"]);
  assert.equal(near.more, false);
});

test("slotsNearPeriod: nada depois da parte pede os mais tarde do dia, e avisa que há mais antes", () => {
  // Noite sem horário e o dia acaba antes dela: os 6 mais tarde (os mais próximos), não a página da manhã
  const near = slotsNearPeriod(hours(9, 10, 11, 12, 13, 14, 15, 16, 17), "evening", tz, 6);
  assert.deepEqual(shown(near.shown), ["12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]);
  assert.equal(near.more, true);
});

test("slotsNearPeriod: poucos horários no dia cabem numa página, sem aviso de mais", () => {
  const near = slotsNearPeriod(hours(9, 10, 11), "afternoon", tz, 6);
  assert.deepEqual(shown(near.shown), ["09:00", "10:00", "11:00"]);
  assert.equal(near.more, false);
});

test("slotsNearPeriod: manhã sem horário, tudo é depois dela: a primeira página, com mais", () => {
  const near = slotsNearPeriod(hours(12, 13, 14, 15, 16, 17, 18, 19), "morning", tz, 6);
  assert.deepEqual(shown(near.shown), ["12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]);
  assert.equal(near.more, true);
});

test("slotsNearPeriod: ordena o que chega fora de ordem antes de escolher", () => {
  const near = slotsNearPeriod(hours(19, 9, 18), "afternoon", tz, 6);
  assert.deepEqual(shown(near.shown), ["18:00", "19:00"]);
});
