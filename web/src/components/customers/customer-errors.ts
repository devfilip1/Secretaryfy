import { ApiError } from "../../api";

/** Erro da lista: a chave (e o nome) fica no estado e vira texto só ao mostrar, então trocar o idioma não refaz a busca. */
export type ErrorMessage = { key: "errors.load" | "errors.notFound" | "errors.invalidBody" | "errors.delete"; values?: { name: string } };

/** Erro do servidor com texto próprio; qualquer outro usa o texto genérico da ação. */
export function serverErrorKey(err: unknown): "errors.notFound" | "errors.invalidBody" | undefined {
  if (!(err instanceof ApiError)) return undefined;
  if (err.error === "not_found") return "errors.notFound";
  if (err.error === "invalid_body") return "errors.invalidBody";
  return undefined;
}
