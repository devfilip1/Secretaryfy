import { z } from "zod";
import { RagUnavailableError } from "./client.js";

/** O RAG já está reindexando (409 de POST /reindex). */
export class RagAlreadyIndexingError extends Error {
  constructor() {
    super("already indexing");
    this.name = "RagAlreadyIndexingError";
  }
}

/** Só os campos de /health que o painel usa; o resto da resposta é ignorado. */
const healthSchema = z.object({
  index: z.object({ state: z.string(), built_from: z.string().nullable().optional() }),
});

/** Resposta de POST /reindex. `chunks` é o que rebuild_all devolve, passado como está. */
const reindexSchema = z.object({ chunks: z.unknown(), version: z.string() });

export interface RagHealth {
  state: string;
  indexedVersion: string | null;
}

export interface RagReindex {
  chunks: unknown;
  version: string;
}

export interface RagAdminOptions {
  /** URL do serviço RAG (RAG_SERVICE_URL) */
  url: string;
  /** Token do /reindex (INTERNAL_TOKEN) */
  token: string;
  fetch?: typeof globalThis.fetch;
}

async function send(fetch: typeof globalThis.fetch, url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new RagUnavailableError(`rag unavailable: ${(err as Error).message}`, { cause: err });
  }
}

/** Lê o corpo como JSON e confere a forma; qualquer outra coisa é o RAG indisponível. */
async function readBody<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new RagUnavailableError("rag unavailable: answer is not JSON", { cause: err });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new RagUnavailableError("rag unavailable: unexpected answer");
  return parsed.data;
}

/** Cliente administrativo do RAG: a saúde do índice e a publicação (reindex). */
export function createRagAdmin({ url, token, fetch = globalThis.fetch }: RagAdminOptions) {
  return {
    /** GET /health. Responde 503 com o mesmo corpo quando não está pronto; por isso ambos são lidos. */
    async status(): Promise<RagHealth> {
      const res = await send(fetch, new URL("/health", url), { method: "GET" });
      if (res.status !== 200 && res.status !== 503) {
        throw new RagUnavailableError(`rag unavailable: /health answered ${res.status}`);
      }
      const body = await readBody(res, healthSchema);
      // built_from: versão do conhecimento com que o índice foi construído (manifesto do RAG), null se não há índice
      return { state: body.index.state, indexedVersion: body.index.built_from ?? null };
    },

    /** POST /reindex com o token. 409 vira RagAlreadyIndexingError; falha de rede ou outro erro vira RagUnavailableError. */
    async reindex(): Promise<RagReindex> {
      const res = await send(fetch, new URL("/reindex", url), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 409) throw new RagAlreadyIndexingError();
      if (!res.ok) throw new RagUnavailableError(`rag unavailable: /reindex answered ${res.status}`);
      return readBody(res, reindexSchema);
    },
  };
}

export type RagAdmin = ReturnType<typeof createRagAdmin>;
