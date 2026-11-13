import { DateTime } from "luxon";
import type { TimeWindow } from "../interpret.js";

/** Os limites da janela em instantes (ms) do dia; "first" e "last" já trocados pelos horários da tela */
export interface WindowBounds {
  notBefore: number | null;
  notAfter: number | null;
  near: number | null;
  pick: "earliest" | "latest" | null;
}

/** Um horário "HH:MM" do dia, ou "first"/"last" (o primeiro ou o último horário na tela); nulo se não der */
function instant(value: string | null | undefined, date: string, onScreen: Date[], tz: string): number | null {
  if (!value) return null;
  if (value === "first") return onScreen[0]?.getTime() ?? null;
  if (value === "last") return onScreen.at(-1)?.getTime() ?? null;
  return DateTime.fromISO(`${date}T${value}`, { zone: tz }).toMillis();
}

export function boundsOf(window: TimeWindow, date: string, onScreen: Date[], tz: string): WindowBounds {
  return {
    notBefore: instant(window.notBefore, date, onScreen, tz),
    notAfter: instant(window.notAfter, date, onScreen, tz),
    near: instant(window.near, date, onScreen, tz),
    pick: window.pick ?? null,
  };
}

export interface WindowPick {
  /** Os horários a mostrar, em ordem */
  shown: Date[];
  /** Há mais horários na janela além dos mostrados */
  more: boolean;
  /** Algum horário livre cai na janela; senão, `shown` são os mais próximos dela */
  matched: boolean;
}

const byTime = (a: Date, b: Date) => a.getTime() - b.getTime();

/** Os `page` horários mais perto de `at`, em ordem de horário */
function nearest(slots: Date[], at: number, page: number): Date[] {
  return [...slots]
    .sort((a, b) => Math.abs(a.getTime() - at) - Math.abs(b.getTime() - at))
    .slice(0, page)
    .sort(byTime);
}

/** Dentro da janela: a página que vai ao cliente (perto de `near`, o primeiro ou o último, ou a ponta aberta mais perto). */
function pageOf(matched: Date[], b: WindowBounds, page: number): Date[] {
  if (b.near !== null) return nearest(matched, b.near, page);
  // Só antes de um horário: os mais perto dele, que são os últimos da janela
  const fromEnd = b.pick === "latest" || (b.pick === null && b.notAfter !== null && b.notBefore === null);
  return fromEnd ? matched.slice(-page) : matched.slice(0, page);
}

/**
 * Os horários livres dentro da janela. Os limites são estritos ("depois das 15" não inclui 15h). Sem nenhum horário nela,
 * os mais próximos da referência (near, ou a ponta que existe), com matched = false: o fluxo avisa.
 */
export function pickInWindow(slots: Date[], b: WindowBounds, page: number): WindowPick {
  const sorted = [...slots].sort(byTime);
  const matched = sorted.filter((s) => (b.notBefore === null || s.getTime() > b.notBefore) && (b.notAfter === null || s.getTime() < b.notAfter));
  if (matched.length > 0) {
    const shown = pageOf(matched, b, page);
    return { shown, more: matched.length > shown.length, matched: true };
  }
  const anchor = b.near ?? b.notBefore ?? b.notAfter;
  const shown = anchor === null ? sorted.slice(0, page) : nearest(sorted, anchor, page);
  return { shown, more: false, matched: false };
}
