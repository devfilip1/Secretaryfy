import type { Language } from "../scheduling/dates.js";

/** Quem é a clínica para o assistente: um objeto só, montado na composição e injetado nos módulos (ADR 0010, passo 1). */
export interface ClinicContext {
  readonly name: string;
  /** Nome da atendente; ausente = a saudação cita só a clínica */
  readonly assistantName?: string;
  /** A língua vem do env no boot: trocá-la exige reiniciar (ADR 0012, passo 2) */
  readonly language: Language;
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
}

/** Os campos são lidos a cada uso, nunca copiados na criação: é assim que a troca pelo painel chega aos textos. */
export function createClinicContext(initial: ClinicIdentity & { language: Language }): ClinicContext {
  const state = { ...initial, assistantName: initial.assistantName || undefined };
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
      return initial.language;
    },
    update(patch) {
      if (patch.name !== undefined) state.name = patch.name;
      // Presente com undefined também vale: é "sem nome da atendente", que o banco pode guardar
      if ("assistantName" in patch) state.assistantName = patch.assistantName || undefined;
      if (patch.kind !== undefined) state.kind = patch.kind;
    },
  };
}
