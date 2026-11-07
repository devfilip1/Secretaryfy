import { ApiError } from "../../api";

/** Um campo recusado pelo servidor (400 invalid_body): caminho técnico e mensagem em inglês. */
export interface FieldIssue {
  path: string;
  message: string;
}

function isFieldIssue(value: unknown): value is FieldIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FieldIssue).path === "string" &&
    typeof (value as FieldIssue).message === "string"
  );
}

/** "treatmentName" -> "treatment name" */
function words(segment: string): string {
  return segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * Caminho do servidor em texto para a dona da clínica: "data.facts.0.value" -> "Facts, row 1, value".
 * O "data" da raiz some; número vira "row N" (a primeira linha é a 1, não a 0).
 */
export function humanizePath(path: string): string {
  const segments = path.split(".").filter((segment) => segment !== "");
  if (segments[0] === "data") segments.shift();
  const parts = segments.map((segment) => (/^\d+$/.test(segment) ? `row ${Number(segment) + 1}` : words(segment)));
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Uma frase por campo: "Facts, row 1, value: this field is required". */
export function fieldLine({ path, message }: FieldIssue): string {
  const label = humanizePath(path);
  const sentence = message.charAt(0).toLowerCase() + message.slice(1);
  return label === "" ? message : `${label}: ${sentence}`;
}

/** Linhas do aviso: a mensagem do servidor e, depois, uma linha por campo recusado. */
export function reasonLines(err: unknown, fallback: string): string[] {
  if (!(err instanceof ApiError)) return [fallback];
  const message = typeof err.body.message === "string" && err.body.message.trim() !== "" ? err.body.message : fallback;
  const fields = Array.isArray(err.body.fields) ? err.body.fields.filter(isFieldIssue) : [];
  return [message, ...fields.map(fieldLine)];
}

/** O motivo que o servidor deu (campo `message`, como no 400 invalid_body); a reserva só quando não há um. */
export function serverReason(err: unknown, fallback: string): string {
  return reasonLines(err, fallback)[0];
}
