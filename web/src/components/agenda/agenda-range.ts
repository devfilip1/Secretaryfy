// Alcance da agenda (Dia, 7 dias ou Mês): regras puras e a lembrança no localStorage, à prova de falhas.

export const AGENDA_RANGES = ["day", "week", "month"] as const;
export type AgendaRange = (typeof AGENDA_RANGES)[number];

/** Chave do localStorage com a escolha de alcance da agenda. */
export const AGENDA_RANGE_KEY = "secretaryfy.agendaRange";

const DEFAULT_RANGE: AgendaRange = "day";

/** Dias pedidos ao servidor para cada alcance: Dia e 7 dias usam 7; Mês, 31. */
export const AGENDA_FETCH_DAYS: Record<AgendaRange, number> = { day: 7, week: 7, month: 31 };

/** Um valor guardado só vale se for um dos alcances; qualquer outro cai no Dia. */
export function parseAgendaRange(value: unknown): AgendaRange {
  return (AGENDA_RANGES as readonly unknown[]).includes(value) ? (value as AgendaRange) : DEFAULT_RANGE;
}

/** localStorage pode estar bloqueado (modo privado, política do navegador): sem acesso, vale o padrão. */
export function readAgendaRange(): AgendaRange {
  try {
    return parseAgendaRange(globalThis.localStorage.getItem(AGENDA_RANGE_KEY));
  } catch {
    return DEFAULT_RANGE;
  }
}

/** Guarda a escolha; sem armazenamento, ela vale só até recarregar a página. */
export function saveAgendaRange(range: AgendaRange): void {
  try {
    globalThis.localStorage.setItem(AGENDA_RANGE_KEY, range);
  } catch {
    // sem armazenamento: a escolha vale só nesta tela
  }
}
