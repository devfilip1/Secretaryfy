// Formatadores de hora e data do painel, funções puras (sem React) para o locale e o fuso dados.

export type PanelLocale = "en-US" | "pt-BR";

/**
 * Formatadores do locale no fuso dado. `now` existe para o teste; no app é o relógio.
 * Sem timeZone, usa o fuso do navegador (como os formatadores antigos de format.ts).
 */
export function createFormats(locale: PanelLocale, timeZone?: string, now: () => Date = () => new Date()) {
  // AAAA-MM-DD no fuso dado: duas datas são o mesmo dia se a chave for igual.
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" });
  const dayFmt = new Intl.DateTimeFormat(locale, { timeZone, day: "2-digit", month: "2-digit" });
  const fullFmt = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "short", timeStyle: "short" });
  const shortDateFmt = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "short" });

  const isToday = (date: Date) => dayKey.format(date) === dayKey.format(now());

  return {
    /** Hora, se for hoje; dia e mês nos outros casos. */
    formatTime: (iso: string) => {
      const date = new Date(iso);
      return isToday(date) ? timeFmt.format(date) : dayFmt.format(date);
    },
    formatDateTime: (iso: string) => fullFmt.format(new Date(iso)),
    /** Só a hora do instante. */
    formatClock: (iso: string) => timeFmt.format(new Date(iso)),
    /** Só o dia e o mês do instante. */
    formatDay: (iso: string) => dayFmt.format(new Date(iso)),
    /** Data curta do instante. */
    formatDate: (iso: string) => shortDateFmt.format(new Date(iso)),
  };
}
