import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultDuration, endOfRoom, formatMinutes, parseDuration, validateDuration } from "./duration";

describe("validateDuration", () => {
  it("aceita múltiplos de 5 de 5 até o máximo", () => {
    assert.equal(validateDuration(5, 90), null);
    assert.equal(validateDuration(60, 90), null);
    assert.equal(validateDuration(90, 90), null);
    assert.equal(validateDuration("45", 90), null);
  });

  it("recusa abaixo de 5 (0 e 4)", () => {
    assert.match(validateDuration(0, 90) ?? "", /minimum is 5/);
    assert.match(validateDuration(4, 90) ?? "", /minimum is 5/);
  });

  it("recusa o que não é múltiplo de 5 (7)", () => {
    assert.match(validateDuration(7, 90) ?? "", /multiple of 5/);
  });

  it("recusa acima do máximo (max + 5)", () => {
    assert.match(validateDuration(95, 90) ?? "", /longest free time.*1 h 30 min/);
  });

  it("recusa vazio, texto e números não inteiros", () => {
    assert.match(validateDuration("", 90) ?? "", /Enter the duration/);
    assert.match(validateDuration("   ", 90) ?? "", /Enter the duration/);
    assert.match(validateDuration("abc", 90) ?? "", /Enter the duration/);
    assert.match(validateDuration(Number.NaN, 90) ?? "", /Enter the duration/);
    assert.match(validateDuration(-5, 90) ?? "", /Enter the duration/);
    assert.match(validateDuration(7.5, 90) ?? "", /Enter the duration/);
  });
});

describe("defaultDuration", () => {
  it("usa a duração do serviço, limitada ao tempo livre", () => {
    assert.equal(defaultDuration(60, 90), 60);
    assert.equal(defaultDuration(60, 45), 45);
    assert.equal(defaultDuration(45, 480), 45);
  });
});

describe("formatMinutes", () => {
  it("formata minutos, horas e horas com minutos", () => {
    assert.equal(formatMinutes(0), "0 min");
    assert.equal(formatMinutes(45), "45 min");
    assert.equal(formatMinutes(60), "1 h");
    assert.equal(formatMinutes(90), "1 h 30 min");
    assert.equal(formatMinutes(120), "2 h");
    assert.equal(formatMinutes(150), "2 h 30 min");
    assert.equal(formatMinutes(480), "8 h");
  });
});

describe("endOfRoom", () => {
  it("soma o tempo livre ao início, em ISO", () => {
    assert.equal(endOfRoom("2026-11-14T12:00:00.000Z", 90), "2026-11-14T13:30:00.000Z");
    assert.equal(endOfRoom("2026-11-14T12:00:00.000Z", 0), "2026-11-14T12:00:00.000Z");
  });
});

describe("parseDuration", () => {
  it("lê minutos, horas e os dois juntos", () => {
    assert.equal(parseDuration("90"), 90);
    assert.equal(parseDuration("45 min"), 45);
    assert.equal(parseDuration("2h"), 120);
    assert.equal(parseDuration("1h30"), 90);
    assert.equal(parseDuration("1 h 30 min"), 90);
    assert.equal(parseDuration("1:30"), 90);
    assert.equal(parseDuration(" 2 H "), 120);
  });

  it("devolve null para o que não é duração", () => {
    for (const text of ["", "abc", "h", "7.5", "-5", "1h x"]) assert.equal(parseDuration(text), null, text);
  });
});
