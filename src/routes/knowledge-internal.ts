import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { toDocument } from "../modules/knowledge/render.js";
import type { KnowledgeRepository } from "../modules/knowledge/repository.js";

interface Deps {
  repo: Pick<KnowledgeRepository, "list">;
  clinicName: string;
  /** Token do endpoint (INTERNAL_TOKEN); vazio = a rota não existe */
  token: string;
}

const sha256 = (text: string): Buffer => createHash("sha256").update(text).digest();

/** Compara com `timingSafeEqual` sobre os hashes, para que o tamanho do token não vaze. */
function authorized(header: string | undefined, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  return match !== null && timingSafeEqual(sha256(match[1]), sha256(token));
}

/**
 * GET /internal/knowledge: o conhecimento da clínica para o serviço RAG (docs/integrations.md).
 * Fica fora do login do painel; protegido só pelo token do cabeçalho Authorization.
 */
export function knowledgeInternalRoutes({ repo, clinicName, token }: Deps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    if (!token) return;
    app.get("/internal/knowledge", async (req, reply) => {
      if (!authorized(req.headers.authorization, token)) return reply.code(401).send({ error: "unauthorized" });
      return toDocument(clinicName, await repo.list());
    });
  };
}
