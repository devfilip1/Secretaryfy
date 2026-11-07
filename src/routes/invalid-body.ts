import type { FastifyReply } from "fastify";
import type { z } from "zod";

/** Texto em inglês do painel para cada problema: pelo código do zod, sem o jargão dele. */
function messageFor(issue: z.core.$ZodIssue): string {
  if (issue.code === "too_small" && issue.origin === "string") {
    return issue.minimum <= 1 ? "This field is required" : "This value is too short";
  }
  if (issue.code === "too_big") return "This value is too long";
  if (issue.code === "invalid_format") return "This value has the wrong format";
  return "This value is not valid";
}

/** Responde 400 invalid_body com uma lista de campos (caminho legível e mensagem) para o painel mostrar. */
export function invalidBody(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "invalid_body",
    message: "Some fields need attention.",
    fields: error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: messageFor(issue),
    })),
  });
}
