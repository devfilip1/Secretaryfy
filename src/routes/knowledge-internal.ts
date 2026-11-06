import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { toDocument } from "../modules/knowledge/render.js";
import type { Language } from "../modules/scheduling/dates.js";
import type { KnowledgeRepository } from "../modules/knowledge/repository.js";
import { hoursLines } from "../modules/knowledge/hours.js";
import type { WeeklyHours } from "../db/schema.js";

interface Deps {
  repo: Pick<KnowledgeRepository, "list">;
  /** Regras de atendimento: o horário da seção da clínica sai delas (BR-KNO-02) */
  rules: { get(): Promise<{ weeklyHours: WeeklyHours }> };
  /** Lido a cada pedido: trocar o nome muda a versão do documento */
  clinic: { name: string };
  /** Língua da clínica: os avisos dos fatos com `assessment` saem nela */
  language: Language;
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
export function knowledgeInternalRoutes({ repo, rules, clinic, language, token }: Deps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    if (!token) return;
    app.get("/internal/knowledge", async (req, reply) => {
      if (!authorized(req.headers.authorization, token)) return reply.code(401).send({ error: "unauthorized" });
      const { weeklyHours } = await rules.get();
      return toDocument(clinic.name, await repo.list(), language, hoursLines(weeklyHours, language));
    });
  };
}
