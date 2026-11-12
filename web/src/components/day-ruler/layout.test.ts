import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCK_GAP_PCT, clockLabel, dayKeyOf, layoutDay, minutesOfDay, weekdayKeyOf, type RulerAppointment } from "./layout";

const TZ = "America/Sao_Paulo"; // UTC-3 o ano todo desde 2019
const HOURS = { start: "09:00", end: "18:00" }; // 540 min de régua
const NOON = new Date("2026-11-11T12:00:00-03:00");

const at = (hhmm: string) => `2026-11-11T${hhmm}:00-03:00`;
/** "HH:MM" mais N minutos, no mesmo dia (sem passar da meia-noite nos testes). */
const plus = (hhmm: string, minutes: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const appt = (id: string, hhmm: string, extra: Partial<RulerAppointment> = {}): RulerAppointment => ({
  id,
  startsAt: at(hhmm),
  endsAt: at(plus(hhmm, 30)),
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
  assert.deepEqual(layout.pins.map((p) => p.leftPct), [0, 95]);
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

test("sem consultas: lista vazia, contagem zero, uma faixa e sem próxima", () => {
  const layout = layoutDay({ ...base, appointments: [] });
  assert.equal(layout.open, true);
  assert.deepEqual(layout.pins, []);
  assert.equal(layout.count, 0);
  assert.equal(layout.lanes, 1);
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

test("consultas que já começaram são passadas: contam como feitas e saem da próxima", () => {
  const layout = layoutDay({ ...base, appointments: [appt("1", "10:00"), appt("2", "12:00"), appt("3", "15:00")] });
  assert.deepEqual(layout.pins.map((p) => p.passed), [true, true, false]);
  assert.deepEqual([layout.count, layout.done, layout.left], [3, 2, 1]);
  assert.equal(layout.next?.id, "3");
});

test("sem consulta passada, tudo está por vir; no fim do dia, tudo feito", () => {
  const before = layoutDay({ ...base, now: new Date("2026-11-11T08:00:00-03:00"), appointments: [appt("1", "10:00")] });
  assert.deepEqual([before.done, before.left], [0, 1]);
  const after = layoutDay({ ...base, now: new Date("2026-11-11T19:00:00-03:00"), appointments: [appt("1", "10:00")] });
  assert.deepEqual([after.done, after.left, after.next], [1, 0, null]);
});

test("dia fechado ainda conta feitas e restantes", () => {
  const layout = layoutDay({ ...base, hours: null, appointments: [appt("1", "10:00"), appt("2", "16:00")] });
  assert.deepEqual([layout.done, layout.left], [1, 1]);
});

test("progresso da linha: 0 antes da abertura, proporcional no dia, 100 depois do fechamento", () => {
  const pct = (hhmm: string) => layoutDay({ ...base, now: new Date(`2026-11-11T${hhmm}:00-03:00`), appointments: [] }).progressPct;
  assert.equal(pct("08:00"), 0);
  assert.equal(pct("13:30"), 50);
  assert.ok(Math.abs(pct("12:00") - 100 / 3) < 0.01);
  assert.equal(pct("19:00"), 100);
});

test("largura do bloco é proporcional à duração (endsAt - startsAt), menos a folga", () => {
  const layout = layoutDay({ ...base, appointments: [appt("1", "10:00", { endsAt: at("11:00") })] });
  assert.equal(layout.pins[0].durationMinutes, 60);
  assert.ok(Math.abs(layout.pins[0].widthPct - ((60 / 540) * 100 - BLOCK_GAP_PCT)) < 0.01);
});

test("consulta curta ganha a largura mínima para continuar clicável", () => {
  const layout = layoutDay({ ...base, appointments: [appt("1", "10:00", { endsAt: at("10:05") })] });
  assert.ok(Math.abs(layout.pins[0].widthPct - (5 - BLOCK_GAP_PCT)) < 1e-9);
});

test("bloco que passa do fechamento fica dentro da régua", () => {
  const layout = layoutDay({ ...base, appointments: [appt("1", "17:30", { endsAt: at("18:30") })] });
  const [pin] = layout.pins;
  assert.ok(pin.leftPct + pin.widthPct <= 100 + 1e-9);
  assert.ok(Math.abs(pin.leftPct - (510 / 540) * 100) < 0.01);
});

test("consulta fora do horário fica encostada na borda, dentro da régua", () => {
  const layout = layoutDay({ ...base, appointments: [appt("1", "19:00", { endsAt: at("19:30") })] });
  const end = layout.pins[0].leftPct + layout.pins[0].widthPct;
  assert.ok(end <= 100 && end > 99);
});

test("em andamento: começou e ainda não terminou; já terminada não está em andamento", () => {
  const layout = layoutDay({
    ...base,
    appointments: [appt("1", "11:30", { endsAt: at("12:30") }), appt("2", "10:00")],
  });
  const byId = Object.fromEntries(layout.pins.map((p) => [p.id, p]));
  assert.deepEqual([byId["1"].passed, byId["1"].inProgress], [true, true]);
  assert.deepEqual([byId["2"].passed, byId["2"].inProgress], [true, false]);
});

test("rótulo da marca some quando colide com o marcador de agora", () => {
  const layout = layoutDay({ ...base, appointments: [] });
  const shown = Object.fromEntries(layout.ticks.map((t) => [t.minutes / 60, t.labelShown]));
  // agora = 12:00 (33%): a marca de 12 h some; 10 h e 18 h continuam
  assert.equal(shown[12], false);
  assert.equal(shown[10], true);
  assert.equal(shown[18], true);
});

test("consultas seguidas (uma termina onde a outra começa) ficam na mesma faixa, sem deslocar o início", () => {
  const layout = layoutDay({
    ...base,
    appointments: [appt("1", "10:00", { endsAt: at("10:45") }), appt("2", "10:45", { endsAt: at("11:30") }), appt("3", "11:30", { endsAt: at("12:15") })],
  });
  assert.deepEqual(layout.pins.map((p) => p.lane), [0, 0, 0]);
  assert.equal(layout.lanes, 1);
  // o início do segundo continua exatamente em 10:45; a folga sai da largura do primeiro
  assert.ok(Math.abs(layout.pins[1].leftPct - (105 / 540) * 100) < 1e-9);
  assert.ok(layout.pins[0].leftPct + layout.pins[0].widthPct < layout.pins[1].leftPct);
});

test("sobreposição de verdade vai para a faixa de baixo e a régua ganha uma faixa", () => {
  const layout = layoutDay({ ...base, appointments: [appt("1", "10:00", { endsAt: at("11:00") }), appt("2", "10:30", { endsAt: at("11:30") })] });
  assert.deepEqual(layout.pins.map((p) => p.lane), [0, 1]);
  assert.equal(layout.lanes, 2);
});

test("consultas curtas que só se tocam pela largura mínima também se sobrepõem", () => {
  // 10:00 dura 5 min mas ocupa a largura mínima; 10:06 começa antes de essa largura acabar
  const layout = layoutDay({ ...base, appointments: [appt("1", "10:00", { endsAt: at("10:05") }), appt("2", "10:06", { endsAt: at("10:36") })] });
  assert.deepEqual(layout.pins.map((p) => p.lane), [0, 1]);
});

test("três blocos sobrepostos usam três faixas; a régua cresce com elas", () => {
  const layout = layoutDay({
    ...base,
    appointments: [appt("1", "10:00", { endsAt: at("11:00") }), appt("2", "10:15", { endsAt: at("11:15") }), appt("3", "10:30", { endsAt: at("11:30") })],
  });
  assert.deepEqual(layout.pins.map((p) => p.lane), [0, 1, 2]);
  assert.equal(layout.lanes, 3);
});

test("uma faixa livre volta a ser usada depois de uma sobreposição", () => {
  const layout = layoutDay({
    ...base,
    appointments: [appt("1", "10:00", { endsAt: at("11:00") }), appt("2", "10:30", { endsAt: at("11:30") }), appt("3", "11:30", { endsAt: at("12:30") })],
  });
  assert.deepEqual(layout.pins.map((p) => p.lane), [0, 1, 0]);
  assert.equal(layout.lanes, 2);
});
