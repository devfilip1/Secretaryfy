import type { ClinicContext } from "../clinic/context.js";
import type { ServiceCatalog } from "./catalog.js";
import type { ChatMessage, OllamaClient } from "./ollama.js";
import { createOptionExtractor } from "./understanding/option.js";
import { createAgreementReader } from "./understanding/agreement.js";
import { quotedByCustomer } from "./understanding/quote.js";
import { createSenseReader } from "./understanding/sense.js";
import { createWhenExtractor } from "./understanding/when.js";
import { byRules } from "./interpret/rules.js";
import { formatFor, mentionFormat, mentionPrompt, systemPrompt } from "./interpret/prompt.js";
import { mentionOutput, validate } from "./interpret/validate.js";
import type { InterpretInput, Interpretation } from "./interpret/types.js";

export type { DayPeriod, When } from "./understanding/when.js";

export { INTENTS } from "./intents.js";
export type { Intent } from "./intents.js";
export { cleanName, nameInText } from "./interpret/names.js";
export type { Interpretation, InterpretInput, TimeWindow } from "./interpret/types.js";

const HISTORY_LIMIT = 20;

export function createInterpreter({
  ollama,
  clinic,
  catalog,
}: {
  ollama: Pick<OllamaClient, "chat">;
  clinic: Pick<ClinicContext, "name" | "kind" | "language">;
  catalog: ServiceCatalog;
}) {
  const when = createWhenExtractor({ ollama });
  const pick = createOptionExtractor({ ollama });
  const sense = createSenseReader({ ollama });
  const agreement = createAgreementReader({ ollama });
  return {
    /** Lança InterpreterUnavailable se o modelo for necessário e o Ollama não responder. */
    async interpret(input: InterpretInput): Promise<Interpretation> {
      const ruled = byRules(input, catalog);
      if (ruled) return ruled;

      const raw = await ollama.chat({
        format: formatFor(catalog, clinic.language),
        messages: [
          { role: "system", content: systemPrompt(input, clinic, catalog) },
          ...input.history.slice(-HISTORY_LIMIT),
          { role: "user", content: input.text },
        ],
      });
      return validate(raw, input, catalog);
    },
    mentionedWhen: when,
    mentionedOption: pick,
    mentionedSense: sense,
    mentionedAgreement: agreement,

    /**
     * O tratamento de que a conversa fala (o citado por último), numa chamada só, sem regras por palavra. Qualquer falha
     * vira null: o fluxo pergunta o serviço como antes.
     */
    async mentionedService({
      history,
      text,
      log,
    }: {
      history: ChatMessage[];
      text: string;
      log?: { error: (obj: object, msg: string) => void };
    }): Promise<string | null> {
      try {
        const raw = await ollama.chat({
          format: mentionFormat(catalog, clinic.language),
          messages: [
            { role: "system", content: mentionPrompt(catalog, clinic.language) },
            ...history.slice(-HISTORY_LIMIT),
            { role: "user", content: text },
          ],
        });
        const parsed = mentionOutput.safeParse(raw);
        if (!parsed.success || parsed.data.service === null) return null;
        // Sem uma citação que esteja nas mensagens do cliente, o modelo está chutando (ex.: o primeiro da lista)
        if (!quotedByCustomer(parsed.data.quote, history, text)) return null;
        return catalog.byLabel(parsed.data.service);
      } catch (err) {
        log?.error({ err: (err as Error).message }, "tratamento citado indisponível");
        return null;
      }
    },
  };
}

export type Interpreter = ReturnType<typeof createInterpreter>;
