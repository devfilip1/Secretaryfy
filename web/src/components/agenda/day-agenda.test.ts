import assert from "node:assert/strict";
import { test } from "node:test";
import type { Appointment } from "../../api";
import { agendaDays, agendaGroups, agendaStatusOf, dayItems } from "./day-agenda";

type Situation = Pick<Appointment, "confirmedAt" | "reminder">;

const reminder = (label: Appointment["reminder"]["label"]): Situation["reminder"] => ({ label, reason: null, sentAt: null });

test("consulta confirmada com lembrete normal fica cheia", () => {
  const situation: Situation = { confirmedAt: "2026-11-10T10:00:00Z", reminder: reminder("confirmed") };
  assert.equal(agendaStatusOf(situation), "confirmed");
});

test("consulta sem confirmação fica vazada", () => {
  const situation: Situation = { confirmedAt: null, reminder: reminder("scheduled") };
  assert.equal(agendaStatusOf(situation), "waiting");
});

test("lembrete manual ou não enviado vai para a equipe, mesmo confirmada", () => {
  assert.equal(agendaStatusOf({ confirmedAt: null, reminder: reminder("remind_manually") }), "needs_team");
  assert.equal(agendaStatusOf({ confirmedAt: "2026-11-10T10:00:00Z", reminder: reminder("not_sent") }), "needs_team");
});

test("a janela tem 7 dias seguidos a partir de hoje no fuso da clínica", () => {
  const days = agendaDays(new Date("2026-11-11T12:00:00Z"), "UTC");
  assert.equal(days.length, 7);
  assert.equal(days[0].key, "2026-11-11");
  assert.equal(days[6].key, "2026-11-17");
});

test("agendaGroups: um grupo por dia com consulta, em ordem de dia e de horário, sem dias vazios", () => {
  const at = (id: string, startsAt: string) => ({ id, startsAt }) as Appointment;
  const items = [at("c", "2026-11-13T09:00:00Z"), at("b", "2026-11-11T15:00:00Z"), at("a", "2026-11-11T09:00:00Z")];
  const groups = agendaGroups(items, "UTC");
  assert.deepEqual(
    groups.map((g) => g.key),
    ["2026-11-11", "2026-11-13"],
  );
  assert.deepEqual(
    groups[0].items.map((a) => a.id),
    ["a", "b"],
  );
  assert.deepEqual(
    groups[1].items.map((a) => a.id),
    ["c"],
  );
  assert.deepEqual(agendaGroups([], "UTC"), []);
});

test("dayItems devolve só o dia pedido, em ordem de horário", () => {
  const at = (id: string, startsAt: string) => ({ id, startsAt }) as Appointment;
  const items = [at("b", "2026-11-11T15:00:00Z"), at("x", "2026-11-12T09:00:00Z"), at("a", "2026-11-11T09:00:00Z")];
  assert.deepEqual(
    dayItems(items, "2026-11-11", "UTC").map((a) => a.id),
    ["a", "b"],
  );
  assert.equal(items[0].id, "b", "não altera a lista recebida");
});
