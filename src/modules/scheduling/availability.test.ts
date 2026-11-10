import assert from "node:assert/strict";
import { test } from "node:test";
import type { Interval } from "../google/gateway.js";
import {
  availableDays,
  bookingWindow,
  dayStatuses,
  naturalSlotsForDay,
  slotsForDay,
  startsWithRoom,
  STAFF_MAX_DAYS_AHEAD,
} from "./availability.js";
import { DEFAULT_RULES, type Rules } from "./rules.js";

const timeZone = "America/Bahia";
// Terça, 20/10/2026, 15:00 em Salvador
const now = new Date("2026-10-20T18:00:00Z");
const at = (local: string) => new Date(`${local}-03:00`);
const times = (slots: Date[]) => slots.map((s) => s.toISOString());
// Grade de 60 min: os testes antigos contam um horário por hora; a grade de 15 min tem os seus testes mais abaixo
const rules = (patch: Partial<Rules> = {}): Rules => ({ ...DEFAULT_RULES, gridMinutes: 60, ...patch });

// Tabela da duração máxima por início (painel): a grade de 15 min deixa ver os inícios entre as horas
const roomCases: {
  name: string;
  start: string;
  /** Dia do teste; sem ele, terça, 21/10 */
  date?: string;
  busy?: Interval[];
  rules?: Partial<Rules>;
  now?: Date;
  /** Duração máxima esperada; null quando o início não está livre */
  maxMinutes: number | null;
}[] = [
  { name: "limitado pelo próximo horário ocupado", start: "09:00", busy: [{ start: at("2026-10-21T11:00"), end: at("2026-10-21T12:00") }], rules: { gridMinutes: 15 }, maxMinutes: 120 },
  { name: "ocupação anterior ao início não limita (cap de 480 min)", start: "09:00", busy: [{ start: at("2026-10-21T08:00"), end: at("2026-10-21T08:30") }], rules: { gridMinutes: 15 }, maxMinutes: 480 },
  { name: "fechamento do dia limita", start: "17:00", rules: { gridMinutes: 15 }, maxMinutes: 60 },
  { name: "teto de 480 min mesmo com o dia todo livre", start: "09:00", rules: { gridMinutes: 15, weeklyHours: { "3": { start: "06:00", end: "20:00" } } }, maxMinutes: 480 },
  { name: "início dentro de um horário ocupado não aparece", start: "10:00", busy: [{ start: at("2026-10-21T10:00"), end: at("2026-10-21T11:00") }], rules: { gridMinutes: 15 }, maxMinutes: null },
  { name: "início logo antes da ocupação cabe só até ela", start: "09:45", busy: [{ start: at("2026-10-21T10:00"), end: at("2026-10-21T11:00") }], rules: { gridMinutes: 15 }, maxMinutes: 15 },
  { name: "a folga arredonda para baixo a múltiplos de 5", start: "09:45", busy: [{ start: at("2026-10-21T10:07"), end: at("2026-10-21T11:00") }], rules: { gridMinutes: 15 }, maxMinutes: 20 },
  { name: "antecedência mínima: início antes do primeiro horário possível não aparece", date: "2026-10-20", start: "16:45", rules: { gridMinutes: 15 }, maxMinutes: null },
  { name: "antecedência mínima: primeiro início possível de hoje tem a folga até o fechamento", date: "2026-10-20", start: "17:00", rules: { gridMinutes: 15 }, maxMinutes: 60 },
];

for (const c of roomCases) {
  test(`duração máxima por início: ${c.name}`, () => {
    const date = c.date ?? "2026-10-21";
    const found = startsWithRoom(date, { rules: rules(c.rules), busy: c.busy ?? [], now: c.now ?? now, timeZone }).find(
      (s) => s.start.getTime() === at(`${date}T${c.start}`).getTime(),
    );
    assert.equal(found?.maxMinutes ?? null, c.maxMinutes);
  });
}

test("duração máxima: os inícios são os da grade e os livres de slotsForDay, com a mesma ordem", () => {
  const ctx = { rules: rules({ gridMinutes: 15 }), busy: [{ start: at("2026-10-21T11:00"), end: at("2026-10-21T12:00") }], now, timeZone };
  const starts = startsWithRoom("2026-10-21", ctx).map((s) => s.start.toISOString());
  assert.deepEqual(starts, slotsForDay("2026-10-21", { ...ctx, minutes: 5 }).map((s) => s.toISOString()));
  assert.equal(startsWithRoom("2026-10-25", ctx).length, 0); // domingo
});

test("horários do dia: do início ao fim, no passo da duração", () => {
  const slots = slotsForDay("2026-10-21", { rules: rules(), busy: [], now, timeZone });
  assert.equal(slots.length, 9);
  assert.equal(slots[0].toISOString(), at("2026-10-21T09:00").toISOString());
  assert.equal(slots.at(-1)!.toISOString(), at("2026-10-21T17:00").toISOString());

  const half = slotsForDay("2026-10-21", {
    rules: rules({ slotMinutes: 45, gridMinutes: 45, weeklyHours: { "3": { start: "09:00", end: "11:00" } } }),
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

test("maxDaysAhead no contexto: a equipe alcança um ano, o paciente segue a janela de 30 dias", () => {
  // 2027-01-28 é uma quinta, 100 dias depois de `now`; 2027-10-20 é uma quarta, dia 365; 2027-10-21 é o dia 366
  const day100 = "2027-01-28";
  assert.deepEqual(slotsForDay(day100, { rules: rules(), busy: [], now, timeZone }), []);
  const staff = { rules: rules(), busy: [], now, timeZone, maxDaysAhead: STAFF_MAX_DAYS_AHEAD };
  assert.ok(slotsForDay(day100, staff).length > 0);
  assert.ok(slotsForDay("2027-10-20", staff).length > 0);
  assert.deepEqual(slotsForDay("2027-10-21", staff), []);
  assert.equal(bookingWindow({ rules: rules(), now, timeZone, maxDaysAhead: STAFF_MAX_DAYS_AHEAD }).lastDate, "2027-10-20");
  // Sem o contexto, a janela é a do paciente
  assert.equal(bookingWindow({ rules: rules(), now, timeZone }).lastDate, "2026-11-19");
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


test("grade de 15 min: inícios de 15 em 15 enquanto o atendimento cabe no dia", () => {
  const r = rules({ gridMinutes: 15, weeklyHours: { "3": { start: "09:00", end: "11:00" } } });
  const slots = slotsForDay("2026-10-21", { rules: r, busy: [], now, timeZone });
  // 60 min: 9:00 a 10:00 (10:15 já não cabe até 11:00)
  assert.deepEqual(times(slots), ["09:00", "09:15", "09:30", "09:45", "10:00"].map((h) => at(`2026-10-21T${h}`).toISOString()));
});

test("a duração do tratamento muda quais inícios cabem e quais ficam livres", () => {
  const r = rules({ gridMinutes: 15, weeklyHours: { "3": { start: "09:00", end: "11:00" } } });
  const busy = [{ start: at("2026-10-21T09:30"), end: at("2026-10-21T10:00") }];
  const short = slotsForDay("2026-10-21", { rules: r, busy, now, timeZone, minutes: 30 });
  assert.deepEqual(times(short), ["09:00", "10:00", "10:15", "10:30"].map((h) => at(`2026-10-21T${h}`).toISOString()));
  const long = slotsForDay("2026-10-21", { rules: r, busy, now, timeZone, minutes: 90 });
  // 90 min só cabe começando às 10:00? Não: 10:00 + 90 passa das 11:00. Nenhum início serve
  assert.deepEqual(long, []);
});

test("horários naturais: o primeiro do dia, o que segue um atendimento e os da duração desde a abertura", () => {
  const r = rules({ gridMinutes: 15, weeklyHours: { "3": { start: "09:00", end: "13:00" } } });
  const busy = [{ start: at("2026-10-21T10:00"), end: at("2026-10-21T10:45") }];
  const natural = naturalSlotsForDay("2026-10-21", { rules: r, busy, now, timeZone, minutes: 60 });
  // 9:00 (abertura), 10:45 (logo depois do atendimento), 11:00 e 12:00 (duração desde a abertura); 9:15 etc. ficam de fora
  assert.deepEqual(times(natural), ["09:00", "10:45", "11:00", "12:00"].map((h) => at(`2026-10-21T${h}`).toISOString()));
});

test("sem nenhum horário natural, todos os livres valem", () => {
  const r = rules({ gridMinutes: 15, weeklyHours: { "3": { start: "09:00", end: "10:00" } } });
  const busy = [{ start: at("2026-10-21T09:00"), end: at("2026-10-21T09:15") }];
  assert.deepEqual(naturalSlotsForDay("2026-10-21", { rules: r, busy, now, timeZone, minutes: 30 }).length > 0, true);
});

test("dayStatuses: dia com horário livre é free; com a agenda ocupada o dia inteiro, full", () => {
  const allDay = [{ start: at("2026-10-21T00:00"), end: at("2026-10-22T00:00") }];
  const status = dayStatuses({ rules: rules({ maxDaysAhead: 7 }), busy: allDay, now, timeZone });
  assert.equal(status["2026-10-21"], "full");
  assert.equal(status["2026-10-22"], "free");
});

test("dayStatuses: dia fechado fica fora do mapa", () => {
  // 25/10/2026 é domingo, sem horário de funcionamento
  const status = dayStatuses({ rules: rules({ maxDaysAhead: 7 }), busy: [], now, timeZone });
  assert.equal("2026-10-25" in status, false);
  assert.equal(status["2026-10-26"], "free");
});

test("dayStatuses: sem horário só por antecedência mínima, o dia sai do mapa e não vira full", () => {
  // Hoje (20/10, 15:00) com 3 h de antecedência: a grade já acaba às 18:00, nenhum horário cabe
  const status = dayStatuses({ rules: rules({ maxDaysAhead: 2, minNoticeMinutes: 180 }), busy: [], now, timeZone });
  assert.equal("2026-10-20" in status, false);
  assert.equal(status["2026-10-21"], "free");
});

test("dayStatuses: a duração muda o estado; gaps de 30 min são full para 60 e free para 30", () => {
  // Terça das 09:00 às 18:00; a agenda deixa livre só meia hora no início de cada hora
  const busy: Interval[] = [];
  for (let h = 9; h < 18; h++) {
    const hh = String(h).padStart(2, "0");
    const next = String(h + 1).padStart(2, "0");
    busy.push({ start: at(`2026-10-21T${hh}:30`), end: at(`2026-10-21T${next}:00`) });
  }
  const base = { rules: rules({ maxDaysAhead: 7 }), busy, now, timeZone };
  assert.equal(dayStatuses({ ...base, minutes: 60 })["2026-10-21"], "full");
  assert.equal(dayStatuses({ ...base, minutes: 30 })["2026-10-21"], "free");
});
