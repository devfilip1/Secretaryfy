import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENDA_FETCH_DAYS, AGENDA_RANGE_KEY, parseAgendaRange, readAgendaRange } from "./agenda-range";

/** Troca o localStorage do teste; o original volta ao fim. */
function withStorage(storage: unknown, run: () => void) {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  try {
    run();
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

test("só os três alcances são aceitos; qualquer outro valor vira Dia", () => {
  assert.equal(parseAgendaRange("month"), "month");
  assert.equal(parseAgendaRange("week"), "week");
  assert.equal(parseAgendaRange("year"), "day");
  assert.equal(parseAgendaRange(null), "day");
});

test("Mês pede 31 dias ao servidor; Dia e 7 dias pedem 7", () => {
  assert.deepEqual(AGENDA_FETCH_DAYS, { day: 7, week: 7, month: 31 });
});

test("lê a escolha guardada e cai no Dia quando o armazenamento falha", () => {
  withStorage({ getItem: (key: string) => (key === AGENDA_RANGE_KEY ? "week" : null) }, () => assert.equal(readAgendaRange(), "week"));
  withStorage(
    {
      getItem: () => {
        throw new Error("blocked");
      },
    },
    () => assert.equal(readAgendaRange(), "day"),
  );
});
