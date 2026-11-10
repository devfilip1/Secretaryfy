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

/** Mensagem em inglês para a duração digitada, ou null se ela vale. `max` é o tempo livre a partir do horário. */
export function validateDuration(value: number | string, max: number): string | null {
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!/^\d+$/.test(text)) return "Enter the duration in minutes.";
  const minutes = Number(text);
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
