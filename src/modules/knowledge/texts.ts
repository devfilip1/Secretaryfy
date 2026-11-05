import type { Language } from "../scheduling/dates.js";

/** Aviso de um fato com `assessment`: o valor é uma faixa e o final sai na avaliação. Na língua da clínica (CLINIC_LANGUAGE). */
export const ASSESSMENT_NOTE: Record<Language, string> = {
  pt: "(valor final definido na avaliação)",
  en: "(final value set at the assessment)",
};
