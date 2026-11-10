import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayPart, durationPresets, groupByDayPart } from "./time-groups.ts";

const TZ = "America/Bahia"; // UTC-3

describe("time-groups", () => {
  it("separa manhã, tarde e noite no fuso da clínica", () => {
    assert.equal(dayPart("2026-11-14T12:00:00Z", TZ), "Morning"); // 09:00 local
    assert.equal(dayPart("2026-11-14T15:00:00Z", TZ), "Afternoon"); // 12:00 local
    assert.equal(dayPart("2026-11-14T21:00:00Z", TZ), "Evening"); // 18:00 local
  });

  it("só devolve as partes que têm horários, em ordem", () => {
    const groups = groupByDayPart(["2026-11-14T21:00:00Z", "2026-11-14T12:00:00Z"], (s) => s, TZ);
    assert.deepEqual(groups.map((g) => g.part), ["Morning", "Evening"]);
  });

  it("oferece só as durações rápidas que cabem", () => {
    assert.deepEqual(durationPresets(45), [15, 30, 45]);
    assert.deepEqual(durationPresets(10), []);
    assert.deepEqual(durationPresets(480), [15, 30, 45, 60, 90, 120, 240]);
  });
});
