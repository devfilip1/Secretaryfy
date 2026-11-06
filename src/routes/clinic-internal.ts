import type { FastifyInstance } from "fastify";
import type { ClinicContext } from "../modules/clinic/context.js";
import type { KnowledgeRow } from "../modules/knowledge/types.js";
import { authorized } from "./knowledge-internal.js";

interface Deps {
  /** Lido a cada pedido: trocar nome ou tipo pelo painel chega ao próximo pedido do RAG */
  clinic: Pick<ClinicContext, "name" | "kind" | "language">;
  /** Os tratamentos: os outros nomes de cada um viram sinônimos da busca do RAG */
  knowledge: { list(): Promise<KnowledgeRow[]> };
  /** Token do endpoint (INTERNAL_TOKEN); vazio = a rota não existe */
  token: string;
}

/**
 * GET /internal/clinic: a identidade da clínica para o serviço RAG (docs/integrations.md).
 * Mesmo token e mesmo cabeçalho do /internal/knowledge; fica fora do login do painel.
 */
export function clinicInternalRoutes({ clinic, knowledge, token }: Deps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    if (!token) return;
    app.get("/internal/clinic", async (req, reply) => {
      if (!authorized(req.headers.authorization, token)) return reply.code(401).send({ error: "unauthorized" });
      const treatments = (await knowledge.list()).flatMap((row) =>
        row.kind === "treatment" && row.data.otherNames?.length ? [{ title: row.title, otherNames: row.data.otherNames }] : [],
      );
      return { name: clinic.name, kind: clinic.kind, language: clinic.language, treatments };
    });
  };
}
