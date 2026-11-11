import { useCallback, useEffect, useState } from "react";
import { getCalendar, listAppointments, type Appointment, type CalendarRules } from "../../api";
import { useInboxEvents } from "../../useEvents";
import { dayKeyOf, weekdayKeyOf, type OpeningHours } from "./layout";

const MINUTE_MS = 60_000;

interface Fetched {
  timeZone: string;
  /** Dia (no fuso da clínica) em que a lista foi buscada */
  day: string;
  appointments: Appointment[];
  weeklyHours: CalendarRules["weeklyHours"];
}

export interface TodayData {
  /** undefined até a primeira busca: vale o fuso do navegador */
  timeZone: string | undefined;
  now: Date;
  /** null até a primeira busca dar certo */
  day: { appointments: Appointment[]; hours: OpeningHours | null } | null;
}

/** Agenda de hoje no fuso da clínica. Busca ao abrir, quando os horários mudam, ao voltar a conexão e na virada do dia. */
export function useToday(): TodayData {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(() => {
    Promise.all([listAppointments(), getCalendar()])
      .then(([list, calendar]) =>
        setFetched({
          timeZone: list.timeZone,
          day: dayKeyOf(new Date(), list.timeZone),
          appointments: list.appointments,
          weeklyHours: calendar.rules.weeklyHours,
        }),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Relógio da régua: atualiza o marcador de agora e percebe a virada do dia
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (fetched && dayKeyOf(now, fetched.timeZone) !== fetched.day) load();
  }, [now, fetched, load]);

  useInboxEvents((event) => {
    // calendar.updated: mudou o horário de funcionamento na página Agenda
    if (event.type === "appointments.updated" || event.type === "calendar.updated" || event.type === "reconnected") load();
  });

  if (!fetched) return { timeZone: undefined, now, day: null };
  const today = dayKeyOf(now, fetched.timeZone);
  return {
    timeZone: fetched.timeZone,
    now,
    day: {
      appointments: fetched.appointments.filter((a) => dayKeyOf(new Date(a.startsAt), fetched.timeZone) === today),
      hours: fetched.weeklyHours[weekdayKeyOf(now, fetched.timeZone)] ?? null,
    },
  };
}
