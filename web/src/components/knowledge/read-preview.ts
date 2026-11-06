import type { KnowledgeLabels } from "../../api";
import type { ClinicData } from "./form-values";

/** Campo como o assistente lê: rótulo, valor e, se a chave de faixa de preço estiver ligada, `assessment`. */
export interface ReadBlock {
  label: string;
  value: string;
  assessment?: boolean;
}

/**
 * Texto da linha "The assistant reads" (sem o prefixo): rótulo, valor e a nota da brochura quando a faixa está ligada,
 * por exemplo "Preço: R$ 500 a R$ 900 (valor final definido na avaliação)". Sem valor, não há linha.
 */
export function readLine(block: ReadBlock, assessmentNote: string): string | null {
  const label = block.label.trim();
  const value = block.value.trim();
  if (!value) return null;
  const note = block.assessment && assessmentNote ? ` ${assessmentNote}` : "";
  return `${label ? `${label}: ` : ""}${value}${note}`;
}

/** Um cabeçalho com as suas linhas; sem linhas, o cabeçalho também some. */
function headed(heading: string, lines: string[]): string[] {
  return lines.length > 0 ? [heading, ...lines] : [];
}

/**
 * Linhas da seção da clínica como o assistente as lê, na ordem da brochura. Os horários não estão na seção:
 * vêm da página Agenda (`hours`), já em linhas.
 */
export function clinicReadLines(
  data: ClinicData,
  labels: Pick<KnowledgeLabels, "address" | "hours" | "contact">,
  hours: string[],
): string[] {
  const contact = [data.phone, data.email].filter((line): line is string => Boolean(line));
  return [
    ...data.intro,
    ...headed(labels.address, data.address),
    ...headed(labels.hours, hours),
    ...headed(labels.contact, contact),
    ...data.closing,
  ];
}
