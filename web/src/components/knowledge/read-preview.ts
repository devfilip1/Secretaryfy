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
