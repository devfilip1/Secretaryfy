import type { Appointment } from "../../api";
import { dayKeyOf } from "../day-ruler/layout";

// Agenda do dia: regras puras (situação, janela de dias, consultas de um dia, agrupamento). Sem React.

/** Situação da consulta: define a faixa de cor (cheia, vazada ou coral) */
export type AgendaStatus = "confirmed" | "waiting" | "needs_team";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lembretes que pedem a equipe: o assistente não consegue mandar mensagem para a cliente */
const NEEDS_TEAM_LABELS: ReadonlySet<Appointment["reminder"]["label"]> = new Set(["remind_manually", "not_sent"]);

/** Problema que precisa da equipe ganha da confirmação, como na régua do dia. */
export function agendaStatusOf(appointment: Pick<Appointment, "confirmedAt" | "reminder">): AgendaStatus {
  if (NEEDS_TEAM_LABELS.has(appointment.reminder.label)) return "needs_team";
  return appointment.confirmedAt ? "confirmed" : "waiting";
}

/** Os dias da janela da agenda, de hoje em diante, no fuso da clínica (chave AAAA-MM-DD e uma data para o rótulo). */
export function agendaDays(now: Date, timeZone: string | undefined, count = 7): { key: string; date: Date }[] {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(now.getTime() + i * DAY_MS);
    return { key: dayKeyOf(date, timeZone), date };
  });
}

/** As consultas de um dia, na ordem do horário. Não altera a lista recebida. */
export function dayItems(appointments: Appointment[], dayKey: string, timeZone: string | undefined): Appointment[] {
  return appointments
    .filter((appointment) => dayKeyOf(new Date(appointment.startsAt), timeZone) === dayKey)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

/** Um dia com consultas na lista de vários dias: a chave do dia e as consultas dele, na ordem do horário. */
export interface AgendaDayGroup {
  key: string;
  items: Appointment[];
}

/** Agrupa as consultas por dia, na ordem dos dias. Dia sem consulta não aparece. Não altera a lista recebida. */
export function agendaGroups(appointments: Appointment[], timeZone: string | undefined): AgendaDayGroup[] {
  const keys = new Set(
    [...appointments]
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .map((appointment) => dayKeyOf(new Date(appointment.startsAt), timeZone)),
  );
  return [...keys].map((key) => ({ key, items: dayItems(appointments, key, timeZone) }));
}
