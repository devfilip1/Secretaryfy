import { z } from "zod";
import type { OllamaClient } from "../ollama.js";

/** Resposta do cliente a uma pergunta de sim ou não: concorda, recusa, ou nenhuma das duas (pergunta, pedido de mudança, assunto alheio) */
export type Agreement = "agree" | "refuse" | "neither";

const AGREEMENTS = ["agree", "refuse", "neither"] as const;
const agreementOutput = z.object({ answer: z.enum(AGREEMENTS) });
const agreementFormat = {
  type: "object",
  properties: { answer: { type: "string", enum: [...AGREEMENTS] } },
  required: ["answer"],
};
const AGREEMENT_PROMPT = [
  "You read one WhatsApp message that a customer sent to a clinic's booking assistant. The assistant had just asked the customer a yes or no question.",
  'Answer "agree" when the message accepts, in any wording, in any language ("pode sim camarada", "fechado", "bora", "yes, go ahead").',
  'Answer "refuse" when the message declines, in any wording ("de jeito nenhum", "nope, keep it", "não quero", "não precisa").',
  'Answer "neither" when the message is a question ("quanto custa?"), a request to change something (another day, another time, another treatment), a message with no answer to the question, or unrelated to it. A message that only repeats the subject of the question without yes or no ("cancelar", "remarcar") is "neither".',
  "Do not guess: when the message does not clearly accept or decline, answer neither.",
].join("\n");

/**
 * Concordância ou recusa do cliente numa pergunta de sim ou não, numa chamada focada que lê só a mensagem.
 * Qualquer falha ou resposta fora do formato vira null: quem chama decide o que fazer sem certeza (ver applyAgreement em resolve.ts).
 */
export function createAgreementReader({ ollama }: { ollama: Pick<OllamaClient, "chat"> }) {
  return async ({ text, log }: { text: string; log?: { error: (obj: object, msg: string) => void } }): Promise<Agreement | null> => {
    try {
      const raw = await ollama.chat({
        format: agreementFormat,
        messages: [
          { role: "system", content: AGREEMENT_PROMPT },
          { role: "user", content: text },
        ],
      });
      const parsed = agreementOutput.safeParse(raw);
      return parsed.success ? parsed.data.answer : null;
    } catch (err) {
      log?.error({ err: (err as Error).message }, "concordância da mensagem indisponível");
      return null;
    }
  };
}
