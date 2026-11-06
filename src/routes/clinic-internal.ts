import type { FastifyInstance } from "fastify";
import type { ClinicContext } from "../modules/clinic/context.js";
import { FIELD_LABELS } from "../modules/knowledge/texts.js";
import type { KnowledgeRow } from "../modules/knowledge/types.js";
import { authorized } from "./knowledge-internal.js";

/** "No consultório: 1 dia | Completo: 14 dias" -> ["No consultório", "Completo"]; um valor sem partes nomeadas não tem nomes. */
function partNames(value: string): string[] {
  const parts = value.split(" | ");
  return parts.length > 1 && parts.every((p) => p.includes(": ")) ? parts.map((p) => p.split(": ")[0]) : [];
}

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
      const { price, duration } = FIELD_LABELS[clinic.language];
      // Os fatos além de preço e duração ("Mensalidade", "Siso") são os valores extras que o RAG precisa distinguir
      const treatments = (await knowledge.list()).flatMap((row) =>
        row.kind === "treatment"
          ? [
              {
                title: row.title,
                otherNames: row.data.otherNames ?? [],
                extraLabels: row.data.facts.flatMap((f) => [...(f.label === price || f.label === duration ? [] : [f.label]), ...partNames(f.value)]),
              },
            ]
          : [],
      );
      return { name: clinic.name, kind: clinic.kind, language: clinic.language, treatments };
    });
  };
}
