import assert from "node:assert/strict";
import { test } from "node:test";
import { clockLabel, dayKeyOf, layoutDay, minutesOfDay, weekdayKeyOf, type RulerAppointment } from "./layout";

const TZ = "America/Sao_Paulo"; // UTC-3 o ano todo desde 2019
const HOURS = { start: "09:00", end: "18:00" };
const NOON = new Date("2026-11-11T12:00:00-03:00");

const at = (hhmm: string) => `2026-11-11T${hhmm}:00-03:00`;
const appt = (id: string, hhmm: string, extra: Partial<RulerAppointment> = {}): RulerAppointment => ({
  id,
  startsAt: at(hhmm),
  customerName: "Rafael Lima",
  service: "Clareamento",
  phone: `55119${id}`,
  confirmedAt: null,
  ...extra,
});
const base = { hours: HOURS, now: NOON, timeZone: TZ, attentionPhones: new Set<string>() };

test("minutesOfDay e dayKeyOf usam o fuso da clínica, não o UTC", () => {
  assert.equal(minutesOfDay(new Date("2026-11-11T12:30:00Z"), TZ), 9 * 60 + 30);
  assert.equal(dayKeyOf(new Date("2026-11-11T02:30:00Z"), TZ), "2026-11-10");
});

test("weekdayKeyOf: 11/11/2026 é quarta, chave \"3\"", () => {
  assert.equal(weekdayKeyOf(NOON, TZ), "3");
  assert.equal(weekdayKeyOf(new Date("2026-11-15T12:00:00-03:00"), TZ), "7");
});

test("clockLabel formata o minuto do dia no idioma dado", () => {
  assert.equal(clockLabel(9 * 60 + 30, "pt-BR"), "09:30");
});

test("consulta antes da abertura e depois do fechamento ficam na borda da régua", () => {
  const layout = layoutDay({ ...base, appointments: [appt("1", "08:00"), appt("2", "19:00")] });
  assert.deepEqual(layout.pins.map((p) => p.leftPct), [0, 100]);
});

test("estado: confirmada, aguardando ou precisa da equipe (mesmo confirmada)", () => {
  const layout = layoutDay({
    ...base,
    attentionPhones: new Set([`55119${3}`]),
    appointments: [appt("1", "10:00", { confirmedAt: at("09:00") }), appt("2", "11:00"), appt("3", "14:00", { confirmedAt: at("09:00") })],
  });
  assert.deepEqual(layout.pins.map((p) => p.status), ["confirmed", "waiting", "needs_team"]);
});

test("dia fechado: sem régua, sem próxima, mas conta as consultas", () => {
  const layout = layoutDay({ ...base, hours: null, appointments: [appt("1", "10:00")] });
  assert.equal(layout.open, false);
  assert.deepEqual(layout.pins, []);
  assert.equal(layout.next, null);
  assert.equal(layout.count, 1);
});

test("sem consultas: lista vazia, contagem zero e sem próxima", () => {
  const layout = layoutDay({ ...base, appointments: [] });
  assert.equal(layout.open, true);
  assert.deepEqual(layout.pins, []);
  assert.equal(layout.count, 0);
  assert.equal(layout.next, null);
});

test("marcador de agora some antes da abertura e depois do fechamento", () => {
  assert.ok(Math.abs(layoutDay({ ...base, appointments: [] }).nowPct! - 100 / 3) < 0.01);
  assert.equal(layoutDay({ ...base, now: new Date("2026-11-11T08:00:00-03:00"), appointments: [] }).nowPct, null);
  assert.equal(layoutDay({ ...base, now: new Date("2026-11-11T19:00:00-03:00"), appointments: [] }).nowPct, null);
});

test("próxima consulta é a primeira que ainda não começou", () => {
  const layout = layoutDay({ ...base, appointments: [appt("1", "10:00"), appt("2", "12:00"), appt("3", "15:00")] });
  assert.equal(layout.next?.id, "3");
});

test("marcas a cada 2 horas nas horas pares, até o fechamento", () => {
  const layout = layoutDay({ ...base, appointments: [] });
  assert.deepEqual(layout.ticks.map((t) => t.minutes / 60), [10, 12, 14, 16, 18]);
});

test("consultas coladas vão para faixas diferentes; distantes ficam na mesma", () => {
  const close = layoutDay({ ...base, appointments: [appt("1", "10:00"), appt("2", "10:05")] });
  assert.deepEqual(close.pins.map((p) => p.lane), [0, 1]);
  const apart = layoutDay({ ...base, appointments: [appt("1", "10:00"), appt("2", "11:00")] });
  assert.deepEqual(apart.pins.map((p) => p.lane), [0, 0]);
});
