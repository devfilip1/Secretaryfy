import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { slugify } from "../modules/knowledge/import-markdown.js";
import { toDocument } from "../modules/knowledge/render.js";
import { KnowledgeOrderError, type KnowledgeRepository } from "../modules/knowledge/repository.js";
import { ASSESSMENT_NOTE, FIELD_LABELS } from "../modules/knowledge/texts.js";
import { invalidBody } from "./invalid-body.js";
import { KNOWLEDGE_KINDS, knowledgeRowSchema } from "../modules/knowledge/types.js";
import { RagAlreadyIndexingError, type RagAdmin } from "../modules/rag/admin.js";
import { RagUnavailableError } from "../modules/rag/client.js";
import type { Language } from "../modules/scheduling/dates.js";
import type { WeeklyHours } from "../db/schema.js";
import { hoursLines } from "../modules/knowledge/hours.js";

interface Deps {
  repo: Pick<KnowledgeRepository, "list" | "get" | "upsert" | "remove" | "reorder">;
  rag: Pick<RagAdmin, "status" | "reindex">;
  /** Regras de atendimento: o horário da seção da clínica sai delas (BR-KNO-02) */
  rules: { get(): Promise<{ weeklyHours: WeeklyHours }> };
  /** Lido a cada pedido: trocar o nome muda a versão do documento (e o status "não publicado") */
  clinic: { name: string };
  /** Língua da clínica: a versão do conteúdo (e o status) muda com ela quando há fatos com `assessment` */
  language: Language;
  /** Depois de cada criação, troca, remoção ou ordem: o catálogo de tratamentos que se podem marcar relê a tabela (ADR 0014) */
  onChange?: () => Promise<void>;
}

/** Chaves que o painel não dá a uma seção: "order" é a rota da ordem (PUT /api/knowledge/order). */
const RESERVED_KEYS = new Set(["order"]);

const keyParams = z.object({ key: z.string().min(1) });
const sectionFields = z.object({
  title: z.string().trim().min(1, "the title can't be empty").max(200),
  tagline: z.string().trim().min(1).max(200).nullable().optional(),
  data: z.unknown(),
});
const createBody = sectionFields.extend({ kind: z.enum(KNOWLEDGE_KINDS) });
const orderBody = z.object({ keys: z.array(z.string().min(1)) }).strict();

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "not_found" });
}

/** Rotas do painel para o conhecimento da clínica e a publicação no RAG (docs/integrations.md). */
export function panelKnowledgeRoutes({ repo, rag, rules, clinic, language, onChange }: Deps) {
  /** Primeira chave livre a partir do título: "sobre-nos", "sobre-nos-2", "sobre-nos-3"… */
  async function freeKey(title: string): Promise<string> {
    const base = slugify(title);
    for (let n = 1; ; n++) {
      const key = n === 1 ? base : `${base}-${n}`;
      if (!RESERVED_KEYS.has(key) && (await repo.get(key)) === null) return key;
    }
  }

  /** Documento de agora: as seções e o horário das regras (o horário não é guardado nas seções). */
  async function document() {
    const { weeklyHours } = await rules.get();
    return toDocument(clinic.name, await repo.list(), language, hoursLines(weeklyHours, language));
  }

  /** Versão dos dados atuais contra a que o RAG tem indexada. */
  async function status() {
    const version = (await document()).version;
    try {
      const { indexedVersion } = await rag.status();
      return { version, indexedVersion, state: indexedVersion === version ? "upToDate" : "unpublished" };
    } catch (err) {
      if (err instanceof RagUnavailableError) return { version, indexedVersion: null, state: "unavailable" };
      throw err;
    }
  }

  return async function (app: FastifyInstance) {
    app.get("/api/knowledge", async () => ({
      sections: await repo.list(),
      labels: { ...FIELD_LABELS[language], assessment: ASSESSMENT_NOTE[language] },
      hours: hoursLines((await rules.get()).weeklyHours, language),
    }));

    app.post("/api/knowledge", async (req, reply) => {
      const body = createBody.safeParse(req.body);
      if (!body.success) return invalidBody(reply, body.error);
      const rows = await repo.list();
      const position = Math.max(-1, ...rows.map((row) => row.position)) + 1;
      const row = knowledgeRowSchema.safeParse({
        key: await freeKey(body.data.title),
        kind: body.data.kind,
        title: body.data.title,
        tagline: body.data.tagline ?? null,
        data: body.data.data,
        position,
      });
      if (!row.success) return invalidBody(reply, row.error);
      await repo.upsert(row.data);
      await onChange?.();
      return reply.code(201).send({ section: row.data });
    });

    // Troca título, slogan e dados; a chave, o tipo e a posição ficam
    app.put<{ Params: { key: string } }>("/api/knowledge/:key", async (req, reply) => {
      const current = await repo.get(req.params.key);
      if (!current) return notFound(reply);
      const body = sectionFields.safeParse(req.body);
      if (!body.success) return invalidBody(reply, body.error);
      const row = knowledgeRowSchema.safeParse({
        ...current,
        title: body.data.title,
        tagline: body.data.tagline ?? null,
        data: body.data.data,
      });
      if (!row.success) return invalidBody(reply, row.error);
      await repo.upsert(row.data);
      await onChange?.();
      return { section: row.data };
    });

    app.delete<{ Params: { key: string } }>("/api/knowledge/:key", async (req, reply) => {
      if (!(await repo.remove(req.params.key))) return notFound(reply);
      await onChange?.();
      return reply.code(204).send();
    });

    app.put("/api/knowledge/order", async (req, reply) => {
      const body = orderBody.safeParse(req.body);
      if (!body.success) return invalidBody(reply, body.error);
      try {
        await repo.reorder(body.data.keys);
      } catch (err) {
        if (err instanceof KnowledgeOrderError) return reply.code(400).send({ error: "invalid_order", message: err.message });
        throw err;
      }
      await onChange?.();
      return reply.code(204).send();
    });

    app.get("/api/knowledge/status", async () => status());

    // O RAG lê a brochura do GET /internal/knowledge deste servidor; por isso o corpo não leva nada
    app.post("/api/knowledge/publish", async (req, reply) => {
      try {
        const { version: indexedVersion } = await rag.reindex();
        const version = (await document()).version;
        return { version, indexedVersion, state: indexedVersion === version ? "upToDate" : "unpublished" };
      } catch (err) {
        if (err instanceof RagAlreadyIndexingError) return reply.code(409).send({ error: "already indexing" });
        if (err instanceof RagUnavailableError) {
          req.log.warn({ err }, "falha ao publicar o conhecimento no RAG");
          return reply.code(502).send({ error: "rag_unavailable" });
        }
        throw err;
      }
    });
  };
}
