import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAGE_SIZE, clampPage, pageCountOf, paginate } from "./pagination";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("paginate", () => {
  it("mostra 20 itens na primeira página e informa o intervalo", () => {
    const s = paginate(range(24), 1);
    assert.equal(PAGE_SIZE, 20);
    assert.deepEqual(s.items, range(20));
    assert.deepEqual([s.from, s.to, s.total, s.pageCount, s.page], [1, 20, 24, 2, 1]);
  });

  it("mostra o restante na última página", () => {
    const s = paginate(range(24), 2);
    assert.deepEqual(s.items, [21, 22, 23, 24]);
    assert.deepEqual([s.from, s.to], [21, 24]);
  });

  it("ajusta a página fora do intervalo para a última", () => {
    const s = paginate(range(21), 9);
    assert.equal(s.page, 2);
    assert.deepEqual(s.items, [21]);
  });

  it("lista vazia tem uma página sem itens e intervalo zerado", () => {
    const s = paginate([], 3);
    assert.deepEqual([s.items, s.page, s.pageCount, s.from, s.to], [[], 1, 1, 0, 0]);
  });
});

describe("clampPage", () => {
  it("nunca fica abaixo da página 1", () => {
    assert.equal(clampPage(0, 50), 1);
    assert.equal(clampPage(-4, 50), 1);
  });

  it("volta para a última página quando a lista encolhe", () => {
    assert.equal(clampPage(3, 41), 3);
    assert.equal(clampPage(3, 40), 2);
  });
});

describe("pageCountOf", () => {
  it("arredonda para cima e não zera", () => {
    assert.equal(pageCountOf(0), 1);
    assert.equal(pageCountOf(20), 1);
    assert.equal(pageCountOf(21), 2);
  });
});
