import type { TFunction } from "i18next";
import { ApiError } from "../../api";

/** Um campo recusado pelo servidor (400 invalid_body): caminho técnico e mensagem em inglês. */
export interface FieldIssue {
  path: string;
  message: string;
}

/** Textos das linhas do aviso, no idioma do painel. Quem não passa estes textos recebe a reserva em inglês. */
export interface ReasonText {
  /** Texto para um código de erro conhecido do servidor; undefined para os outros. */
  code: (code: string) => string | undefined;
  /** "linha 2": o número da linha da brochura (a primeira é a 1). */
  row: (row: number) => string;
  /** Uma linha por campo: "Facts, row 1, value: This field is required". */
  field: (label: string, message: string) => string;
}

const ENGLISH: ReasonText = {
  code: () => undefined,
  row: (row) => `row ${row}`,
  field: (label, message) => `${label}: ${message}`,
};

/** Textos do namespace knowledge para as linhas do aviso. */
export function reasonTextOf(t: TFunction<"knowledge">): ReasonText {
  return {
    code: (code) => {
      if (code === "invalid_body") return t("errors.invalid_body");
      if (code === "clinic_section_required") return t("errors.clinic_section_required");
      return undefined;
    },
    row: (row) => t("reason.row", { row }),
    field: (label, message) => t("reason.field", { label, message }),
  };
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
 * O "data" da raiz some; número vira "row N" (a primeira linha é a 1, não a 0). Os nomes dos campos seguem em inglês.
 */
export function humanizePath(path: string, text: ReasonText = ENGLISH): string {
  const segments = path.split(".").filter((segment) => segment !== "");
  if (segments[0] === "data") segments.shift();
  const parts = segments.map((segment) => (/^\d+$/.test(segment) ? text.row(Number(segment) + 1) : words(segment)));
  const label = parts.join(", ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Uma frase por campo: "Facts, row 1, value: This field is required". */
export function fieldLine(issue: FieldIssue, text: ReasonText = ENGLISH): string {
  const label = humanizePath(issue.path, text);
  return label === "" ? issue.message : text.field(label, issue.message);
}

/** Linhas do aviso: a mensagem (pelo código do servidor, senão a dele) e, depois, uma linha por campo recusado. */
export function reasonLines(err: unknown, fallback: string, text: ReasonText = ENGLISH): string[] {
  if (!(err instanceof ApiError)) return [fallback];
  const serverMessage = typeof err.body.message === "string" && err.body.message.trim() !== "" ? err.body.message : fallback;
  const message = text.code(err.error) ?? serverMessage;
  const fields = Array.isArray(err.body.fields) ? err.body.fields.filter(isFieldIssue) : [];
  return [message, ...fields.map((field) => fieldLine(field, text))];
}

/** O motivo que o servidor deu (campo `message`, como no 400 invalid_body); a reserva só quando não há um. */
export function serverReason(err: unknown, fallback: string, text: ReasonText = ENGLISH): string {
  return reasonLines(err, fallback, text)[0];
}
