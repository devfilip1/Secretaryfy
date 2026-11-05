import type { Language } from "../scheduling/dates.js";

/** Quem é a clínica para o assistente: um objeto só, montado na composição e injetado nos módulos (ADR 0010, passo 1). */
export interface ClinicContext {
  name: string;
  /** Nome da atendente; vazio = a saudação cita só a clínica */
  assistantName?: string;
  language: Language;
  /** O que a clínica é, em inglês, para a prompt do interpretador ("dental clinic") */
  kind: string;
}

/** Lê a identidade de um objeto de configuração (o env, nos pontos de entrada; um literal, nos testes). */
export function buildClinicContext(cfg: {
  CLINIC_NAME: string;
  CLINIC_LANGUAGE: Language;
  ASSISTANT_NAME?: string;
  CLINIC_KIND: string;
}): ClinicContext {
  return {
    name: cfg.CLINIC_NAME,
    assistantName: cfg.ASSISTANT_NAME || undefined,
    language: cfg.CLINIC_LANGUAGE,
    kind: cfg.CLINIC_KIND,
  };
}
