import type { Language } from "../scheduling/dates.js";

/** Quem é a clínica para o assistente: um objeto só, montado na composição e injetado nos módulos (ADR 0010, passo 1). */
export interface ClinicContext {
  readonly name: string;
  /** Nome da atendente; ausente = a saudação cita só a clínica */
  readonly assistantName?: string;
  /** A língua vem do banco e muda ao vivo pelo painel; o env CLINIC_LANGUAGE só semeia enquanto o banco não tem valor (ADR 0016) */
  readonly language: Language;
  /** Oferece a avaliação (primeira consulta) no agendamento; padrão: sim */
  readonly offerAssessment: boolean;
  /** Oferece o retorno (acompanhamento) no agendamento; padrão: não */
  readonly offerFollowUp: boolean;
  /** Duração da avaliação em minutos; null = a duração padrão do calendário */
  readonly assessmentMinutes: number | null;
  /** Duração do retorno em minutos; null = a duração padrão do calendário */
  readonly followUpMinutes: number | null;
  /** O que a clínica é, em inglês, para a prompt do interpretador ("dental clinic") */
  readonly kind: string;
  /** Troca nome, nome da atendente e tipo no mesmo objeto: quem lê os campos depois já vê o valor novo */
  update(patch: Partial<ClinicIdentity>): void;
}

/** A identidade que o painel edita (a tabela clinic_settings). */
export interface ClinicIdentity {
  name: string;
  assistantName?: string;
  kind: string;
  /** Ausente = o banco ainda não tem língua; o env semeia */
  language?: Language;
  /** Ausente = padrão (sim) */
  offerAssessment?: boolean;
  /** Ausente = padrão (não) */
  offerFollowUp?: boolean;
  /** Ausente ou null = a duração padrão do calendário */
  assessmentMinutes?: number | null;
  /** Ausente ou null = a duração padrão do calendário */
  followUpMinutes?: number | null;
}

/** Os campos são lidos a cada uso, nunca copiados na criação: é assim que a troca pelo painel chega aos textos. */
export function createClinicContext(initial: ClinicIdentity & { language: Language }): ClinicContext {
  const state = {
    ...initial,
    assistantName: initial.assistantName || undefined,
    offerAssessment: initial.offerAssessment ?? true,
    offerFollowUp: initial.offerFollowUp ?? false,
    assessmentMinutes: initial.assessmentMinutes ?? null,
    followUpMinutes: initial.followUpMinutes ?? null,
  };
  return {
    get name() {
      return state.name;
    },
    get assistantName() {
      return state.assistantName;
    },
    get kind() {
      return state.kind;
    },
    get language() {
      return state.language;
    },
    get offerAssessment() {
      return state.offerAssessment;
    },
    get offerFollowUp() {
      return state.offerFollowUp;
    },
    get assessmentMinutes() {
      return state.assessmentMinutes;
    },
    get followUpMinutes() {
      return state.followUpMinutes;
    },
    update(patch) {
      if (patch.name !== undefined) state.name = patch.name;
      // Presente com undefined também vale: é "sem nome da atendente", que o banco pode guardar
      if ("assistantName" in patch) state.assistantName = patch.assistantName || undefined;
      if (patch.kind !== undefined) state.kind = patch.kind;
      if (patch.language !== undefined) state.language = patch.language;
      if (patch.offerAssessment !== undefined) state.offerAssessment = patch.offerAssessment;
      if (patch.offerFollowUp !== undefined) state.offerFollowUp = patch.offerFollowUp;
      // null é valor válido: volta à duração padrão do calendário
      if (patch.assessmentMinutes !== undefined) state.assessmentMinutes = patch.assessmentMinutes;
      if (patch.followUpMinutes !== undefined) state.followUpMinutes = patch.followUpMinutes;
    },
  };
}
