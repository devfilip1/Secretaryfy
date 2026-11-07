import type { Language } from "../scheduling/dates.js";

/** Aviso de um fato com `assessment`: o valor é uma faixa e o final sai na avaliação. Na língua da clínica (CLINIC_LANGUAGE). */
export const ASSESSMENT_NOTE: Record<Language, string> = {
  pt: "(valor final definido na avaliação)",
  en: "(final value set at the assessment)",
};

/** Rótulos de cada campo como o folheto os escreve, na língua da clínica: o painel os põe prontos no formulário. */
export interface FieldLabels {
  ideal: string;
  howItWorks: string;
  duration: string;
  price: string;
  result: string;
  recovery: string;
  /** Títulos das partes da seção da clínica (endereço, horário e contato), escritos como estão na brochura */
  address: string;
  hours: string;
  contact: string;
}

export const FIELD_LABELS: Record<Language, FieldLabels> = {
  pt: {
    ideal: "Ideal para quem quer",
    howItWorks: "Como funciona",
    duration: "Duração",
    price: "Preço",
    result: "Resultado",
    recovery: "Recuperação",
    address: "ENDEREÇO",
    hours: "HORÁRIO",
    contact: "CONTATO",
  },
  en: {
    ideal: "Ideal for those who want",
    howItWorks: "How it works",
    duration: "Duration",
    price: "Price",
    result: "Result",
    recovery: "Recovery",
    address: "LOCATION",
    hours: "HOURS",
    contact: "CONTACT",
  },
};

/** Textos do horário gerado das regras (hours.ts): "Fechado", a faixa de dias e a faixa de horas, na língua da clínica. */
export interface HoursTexts {
  closed: string;
  /** Dias seguidos: `first` e `last` já com a inicial maiúscula */
  dayRange(first: string, last: string): string;
  /** Horários "HH:mm" */
  timeRange(start: string, end: string): string;
}

/** Português: "9h", "9h30", "9h às 18h". */
const hourPt = (hhmm: string): string => {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return minutes ? `${hours}h${String(minutes).padStart(2, "0")}` : `${hours}h`;
};

/** Inglês, como o folheto escreve: "9:00 AM", "6:00 PM". */
const hourEn = (hhmm: string): string => {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
};

export const HOURS_TEXT: Record<Language, HoursTexts> = {
  pt: {
    closed: "Fechado",
    dayRange: (first, last) => `${first} a ${last.toLowerCase()}`,
    timeRange: (start, end) => `${hourPt(start)} às ${hourPt(end)}`,
  },
  en: {
    closed: "Closed",
    dayRange: (first, last) => `${first}–${last}`,
    timeRange: (start, end) => `${hourEn(start)}–${hourEn(end)}`,
  },
};
