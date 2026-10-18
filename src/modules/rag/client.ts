/** Cliente do serviço RAG local (rag/server.py). Contrato: specs/001-rag-whatsapp-dentalsafe/contracts/rag-service.md */

export interface RetrievedChunk {
  rank: number;
  content: string;
  score: number | null;
  similarity: number | null;
}

export interface RagAnswer {
  answer: string;
  chunks: RetrievedChunk[];
  latency_s: number;
  experiment: string;
}

/** O assistente não respondeu: fora do ar, erro, tempo limite ou resposta inválida. */
export class RagUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RagUnavailableError";
  }
}

export function createRagClient({ baseUrl, timeoutMs }: { baseUrl: string; timeoutMs: number }) {
  return {
    async ask(question: string): Promise<RagAnswer> {
      let res: Response;
      try {
        res = await fetch(new URL("/answer", baseUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
          // Ao estourar, a requisição é abortada: nenhuma resposta atrasada chega depois
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new RagUnavailableError(`serviço RAG inacessível: ${(err as Error).message}`, { cause: err });
      }

      if (!res.ok) {
        throw new RagUnavailableError(`serviço RAG respondeu ${res.status}: ${await res.text().catch(() => "")}`);
      }

      let body: Partial<RagAnswer>;
      try {
        body = (await res.json()) as Partial<RagAnswer>;
      } catch (err) {
        throw new RagUnavailableError("resposta do serviço RAG não é JSON", { cause: err });
      }
      if (typeof body.answer !== "string") {
        throw new RagUnavailableError("resposta do serviço RAG sem o campo answer");
      }
      return body as RagAnswer;
    },
  };
}
