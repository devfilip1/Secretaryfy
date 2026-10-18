/** Cliente mínimo da /api/chat do Ollama local, com saída restrita por JSON Schema (research.md R2). */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** O Ollama não respondeu a tempo, respondeu com erro ou devolveu algo que não é JSON. */
export class InterpreterUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InterpreterUnavailable";
  }
}

export function createOllamaClient({
  url,
  model,
  timeoutMs,
  fetch: doFetch = fetch,
}: {
  url: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}) {
  return {
    model,
    /** Devolve o JSON gerado pelo modelo, ainda sem validar, ou null se o conteúdo não for JSON. */
    async chat({ messages, format }: { messages: ChatMessage[]; format: object }): Promise<unknown> {
      let res: Response;
      try {
        res = await doFetch(new URL("/api/chat", url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            format,
            stream: false,
            // Mantém o modelo carregado entre as mensagens (SC-008)
            keep_alive: "30m",
            options: { temperature: 0 },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new InterpreterUnavailable(`Ollama inacessível: ${(err as Error).message}`, { cause: err });
      }
      if (!res.ok) throw new InterpreterUnavailable(`Ollama respondeu ${res.status}: ${await res.text().catch(() => "")}`);

      let content: string;
      try {
        content = ((await res.json()) as { message?: { content?: string } }).message?.content ?? "";
      } catch (err) {
        throw new InterpreterUnavailable("resposta do Ollama não é JSON", { cause: err });
      }
      // O modelo respondeu, mas fora do formato: quem chamou trata como "não entendi"
      try {
        return JSON.parse(content);
      } catch {
        return null;
      }
    },
  };
}

export type OllamaClient = ReturnType<typeof createOllamaClient>;
