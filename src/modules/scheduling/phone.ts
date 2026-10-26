/**
 * Telefone digitado no painel no formato que o WhatsApp usa (specs/006 research.md R8): só dígitos, sem o zero da
 * operadora; com 10 ou 11 dígitos é um número do Brasil sem o código do país. null se não parecer um telefone.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : null;
}
