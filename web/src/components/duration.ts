/** Duração do atendimento em minutos: passo de 5, de 5 até o máximo livre a partir do horário escolhido. */

export const DURATION_STEP = 5;
export const MIN_DURATION = 5;

/** Minutos como texto: "45 min", "1 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/**
 * Lê a duração como a equipe escreve: "90" (minutos), "45 min", "2h", "1h30", "1 h 30 min" ou "1:30".
 * Devolve os minutos, ou null se o texto não for uma duração.
 */
export function parseDuration(value: number | string): number | null {
  const text = String(value).trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  const clock = /^(\d+):(\d{1,2})$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const words = /^(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(text);
  if (words && (words[1] || words[2])) return Number(words[1] ?? 0) * 60 + Number(words[2] ?? 0);
  const hourAndRest = /^(\d+)\s*h\s*(\d+)$/.exec(text);
  if (hourAndRest) return Number(hourAndRest[1]) * 60 + Number(hourAndRest[2]);
  return null;
}

/** Mensagem em inglês para a duração digitada, ou null se ela vale. `max` é o tempo livre a partir do horário. */
export function validateDuration(value: number | string, max: number): string | null {
  const minutes = parseDuration(value);
  if (minutes === null) return "Enter the duration, like 45, 2h or 1h30.";
  if (minutes < MIN_DURATION) return `The minimum is ${MIN_DURATION} minutes.`;
  if (minutes % DURATION_STEP !== 0) return `Use a multiple of ${DURATION_STEP} minutes.`;
  if (minutes > max) return `The longest free time from this start is ${formatMinutes(max)}.`;
  return null;
}

/** Duração sugerida: a do serviço, limitada ao tempo livre. */
export function defaultDuration(serviceMinutes: number, max: number): number {
  return Math.min(serviceMinutes, max);
}

/** Fim do tempo livre, como ISO: início mais `maxMinutes`. */
export function endOfRoom(startISO: string, maxMinutes: number): string {
  return new Date(Date.parse(startISO) + maxMinutes * 60_000).toISOString();
}
