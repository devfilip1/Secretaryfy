import type { Language } from "../scheduling/dates.js";

/** Aviso de um fato com `assessment`: o valor é uma faixa e o final sai na avaliação. Na língua da clínica (CLINIC_LANGUAGE). */
export const ASSESSMENT_NOTE: Record<Language, string> = {
  pt: "(valor final definido na avaliação)",
  en: "(final value set at the assessment)",
};

/** Rótulos de cada campo como o folheto os escreve, na língua da clínica: o painel os põe prontos no formulário. */
export const FIELD_LABELS: Record<Language, { ideal: string; howItWorks: string; duration: string; price: string; result: string; recovery: string }> = {
  pt: { ideal: "Ideal para quem quer", howItWorks: "Como funciona", duration: "Duração", price: "Preço", result: "Resultado", recovery: "Recuperação" },
  en: { ideal: "Ideal for those who want", howItWorks: "How it works", duration: "Duration", price: "Price", result: "Result", recovery: "Recovery" },
};
