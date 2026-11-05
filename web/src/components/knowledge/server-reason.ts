import { ApiError } from "../../api";

/** O motivo que o servidor deu (campo `message`, como no 400 invalid_body); a reserva só quando não há um. */
export function serverReason(err: unknown, fallback: string): string {
  if (err instanceof ApiError && typeof err.body.message === "string" && err.body.message.trim() !== "") {
    return err.body.message;
  }
  return fallback;
}
