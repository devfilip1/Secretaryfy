// Modo CALENDAR_MODE=fake: agenda em memória no lugar do Google, para desenvolvimento offline (ver docs/development.md).
import type { ConnectionStore } from "./connection.js";
import type { CalendarOption } from "./gateway.js";

export type CalendarMode = "google" | "fake";

/** Conexão de mentira: o refresh token nunca chega ao Google, porque o gateway é o falso. */
export const FAKE_CONNECTION = {
  email: "agenda-falsa@localhost",
  refreshToken: "fake-calendar-sem-token",
  scopes: "fake",
};

/** Motivo para recusar o modo falso, ou null quando pode subir. */
export function calendarModeRefusal(mode: CalendarMode, nodeEnv: string | undefined): string | null {
  if (mode === "fake" && nodeEnv === "production") {
    return "CALENDAR_MODE=fake não sobe com NODE_ENV=production: a agenda em memória não grava no Google";
  }
  return null;
}

interface FakeModeDeps {
  connection: Pick<ConnectionStore, "get" | "save">;
  calendars: CalendarOption[];
  countAppointments: () => Promise<number>;
}

/**
 * Deixa a conexão "conectada" com a agenda falsa, sem OAuth. Idempotente: se a conexão já é a falsa, não grava de novo.
 * Uma conexão real do Google que estava no banco é substituída (o token antigo não é revogado).
 * Devolve quantos agendamentos existem no banco: a agenda em memória começa vazia, então eles ficam "cancelados no Google".
 */
export async function prepareFakeCalendar({ connection, calendars, countAppointments }: FakeModeDeps) {
  const main = calendars.find((c) => c.primary) ?? calendars[0];
  if (!main) throw new Error("agenda falsa sem nenhum calendário");

  const current = await connection.get();
  const seeded = current.status !== "connected" || current.email !== FAKE_CONNECTION.email;
  if (seeded) {
    await connection.save({ ...FAKE_CONNECTION, calendar: { id: main.id, name: main.name, timeZone: main.timeZone } });
  }
  return { seeded, storedAppointments: await countAppointments() };
}
