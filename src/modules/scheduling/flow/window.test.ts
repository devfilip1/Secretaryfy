import assert from "node:assert/strict";
import { test } from "node:test";
import { pickInWindow, type WindowBounds } from "./window.js";

// Horas do dia 19/11/2026 em Salvador (-03:00); o rótulo de cada horário é a hora cheia, para os testes lerem fácil
const hour = (h: number) => new Date(`2026-11-19T${String(h).padStart(2, "0")}:00:00-03:00`);
const DAY = [9, 10, 11, 12, 13, 14].map(hour);
const ms = (h: number) => hour(h).getTime();
const hoursOf = (dates: Date[]) => dates.map((d) => (d.getTime() - hour(0).getTime()) / 3_600_000);
const NONE: WindowBounds = { notBefore: null, notAfter: null, near: null, pick: null };

test("antes de um horário: os mais perto dele, em ordem, com a página cheia", () => {
  const r = pickInWindow(DAY, { ...NONE, notAfter: ms(11) }, 6);
  assert.deepEqual(hoursOf(r.shown), [9, 10]);
  assert.equal(r.matched, true);
  assert.equal(r.more, false);
});

test("depois de um horário: os primeiros depois dele; os limites são estritos", () => {
  assert.deepEqual(hoursOf(pickInWindow(DAY, { ...NONE, notBefore: ms(11) }, 6).shown), [12, 13, 14]);
  assert.deepEqual(hoursOf(pickInWindow(DAY, { ...NONE, notBefore: ms(10), notAfter: ms(12) }, 6).shown), [11]);
});

test("perto de um horário: os mais perto dele na página, e more quando sobra", () => {
  const r = pickInWindow(DAY, { ...NONE, near: ms(13) }, 3);
  assert.deepEqual(hoursOf(r.shown), [12, 13, 14]);
  assert.equal(r.more, true);
});

test("o último ou o primeiro da janela: a ponta da página, com more quando sobra", () => {
  assert.deepEqual(hoursOf(pickInWindow(DAY, { ...NONE, pick: "latest" }, 2).shown), [13, 14]);
  const earliest = pickInWindow(DAY, { ...NONE, pick: "earliest" }, 2);
  assert.deepEqual(hoursOf(earliest.shown), [9, 10]);
  assert.equal(earliest.more, true);
});

test("janela sem horário livre: matched false e os mais perto da referência", () => {
  const r = pickInWindow(DAY, { ...NONE, notBefore: ms(12), notAfter: ms(12) + 1_800_000 }, 2);
  assert.equal(r.matched, false);
  assert.deepEqual(hoursOf(r.shown), [11, 12]);
  // Sem nenhum horário no dia, a lista sai vazia (o fluxo oferece o dia)
  assert.deepEqual(pickInWindow([], { ...NONE, notAfter: ms(9) }, 6), { shown: [], more: false, matched: false });
});
