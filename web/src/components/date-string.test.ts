import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toDate, toYmd } from "./date-string";

describe("toDate e toYmd", () => {
  it("ida e volta mantém o dia", () => {
    assert.equal(toYmd(toDate("2026-11-09")), "2026-11-09");
  });

  it("toDate usa a data local, sem deslocar para o dia anterior", () => {
    const date = toDate("2026-11-09");
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 10);
    assert.equal(date.getDate(), 9);
  });

  it("fim de mês e virada de ano", () => {
    assert.equal(toYmd(toDate("2026-01-31")), "2026-01-31");
    assert.equal(toYmd(toDate("2026-04-30")), "2026-04-30");
    assert.equal(toYmd(toDate("2026-12-31")), "2026-12-31");
    assert.equal(toYmd(new Date(2027, 0, 1)), "2027-01-01");
  });

  it("29 de fevereiro de 2028 (ano bissexto)", () => {
    assert.equal(toYmd(toDate("2028-02-29")), "2028-02-29");
    assert.equal(toYmd(new Date(2028, 1, 29)), "2028-02-29");
  });

  it("semana da mudança de horário (4 de novembro de 2018 no Brasil) mantém o dia", () => {
    for (const ymd of ["2018-11-03", "2018-11-04", "2018-11-05"]) {
      assert.equal(toYmd(toDate(ymd)), ymd);
      assert.equal(toDate(ymd).getDate(), Number(ymd.slice(8)));
    }
  });

  it("completa zeros à esquerda no mês, no dia e em anos curtos", () => {
    assert.equal(toYmd(new Date(2026, 0, 5)), "2026-01-05");
    assert.equal(toYmd(new Date(999, 0, 1)), "0999-01-01");
  });
});
