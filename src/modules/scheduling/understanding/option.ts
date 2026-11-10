import { z } from "zod";
import type { OllamaClient } from "../ollama.js";
import { quoted } from "./quote.js";

const pickOutput = z.object({ quote: z.string().nullable(), option: z.number().int().nullable() });
const pickFormat = {
  type: "object",
  properties: { quote: { type: ["string", "null"] }, option: { type: ["integer", "null"] } },
  required: ["quote", "option"],
};
const pickPrompt = (count: number) =>
  [
    `The customer is choosing one of ${count} numbered options the assistant just showed in the chat.`,
    `Answer "option" with the number of the option the customer picks, counting from 1 ("the first one" and "the earliest" are 1, "the second" is 2, "o último" and "the last one" are ${count}), or null when the message does not pick one of them by its position or number.`,
    'The pick must be written as a position or a number ("first", "second", "last", "primeiro", "último", "the 2"). Copy those words into "quote" (null when there are none).',
    'These are NOT picks, answer null: another day ("outro dia", "another day"), more options ("mais horários", "more times"), a part of the day ("à tarde", "in the morning"), a weekday, a clock time, a question, a name, yes or no. Do not guess.',
  ].join("\n");

/**
 * Qual das opções numeradas da tela o cliente escolheu pela posição ("the first one", "o último"), numa chamada focada:
 * o modelo às vezes devolve o dia no lugar da opção. A citação tem de estar na mensagem e o número tem de existir. Qualquer falha vira null.
 */
export function createOptionExtractor({ ollama }: { ollama: Pick<OllamaClient, "chat"> }) {
  return async ({ text, count, log }: { text: string; count: number; log?: { error: (obj: object, msg: string) => void } }): Promise<number | null> => {
    try {
      const raw = await ollama.chat({
        format: pickFormat,
        messages: [
          { role: "system", content: pickPrompt(count) },
          { role: "user", content: text },
        ],
      });
      const parsed = pickOutput.safeParse(raw);
      if (!parsed.success) return null;
      const { quote, option } = parsed.data;
      if (option === null || option < 1 || option > count || !quoted(text, quote)) return null;
      return option;
    } catch (err) {
      log?.error({ err: (err as Error).message }, "opção escolhida indisponível");
      return null;
    }
  };
}
