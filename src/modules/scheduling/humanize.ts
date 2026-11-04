import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { OllamaClient } from "./ollama.js";

/**
 * Reescrita opcional (HUMANIZE_REPLIES) das respostas do agendamento: o modelo só reformula o texto que o código montou.
 * Os fatos continuam no código: guardRewrite recusa qualquer reescrita que mude um número, uma linha da lista, uma
 * palavra entre aspas ou SIM/NÃO, e então vale o texto fixo.
 */

const FORMAT = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
} as const;

const OUTPUT = z.object({ message: z.string() });

const LANGUAGE_NAMES = { en: "English", pt: "Brazilian Portuguese" } as const;

/** Linhas que têm de sair exatamente como foram escritas: itens numerados e as de 📅 👤 🦷. */
const FIXED_LINE = /^(?:\d+\. .+|📅.*|👤.*|🦷.*)$/u;
const KEY_WORD = /(?<![\p{L}\p{N}])(?:YES|NO|SIM|NÃO|NAO)(?![\p{L}\p{N}])/giu;
const NUMBER = /\d+(?::\d+)?/g;
const QUOTED = /"[^"]*"/g;

type Warn = Pick<FastifyBaseLogger, "warn">;

const splitLines = (text: string) => text.split(/\r?\n/).map((line) => line.trim());
const matchAll = (text: string, pattern: RegExp): string[] => text.match(pattern) ?? [];

/** Os pedaços do texto que a reescrita não pode alterar. */
export function extractFacts(text: string) {
  return {
    fixedLines: splitLines(text).filter((line) => FIXED_LINE.test(line)),
    numbers: matchAll(text, NUMBER),
    quoted: matchAll(text, QUOTED),
    words: [...new Set(matchAll(text, KEY_WORD).map((word) => word.toUpperCase()))],  };
}

/** A reescrita só passa se mantém todos os fatos do original e não inventa nenhum. */
export function guardRewrite(original: string, rewrite: string): boolean {
  const out = rewrite.trim();
  if (!out || out.length > original.length * 1.6 + 40) return false;
  if (out.includes("**") || out.includes("```") || /^#/m.test(out)) return false;

  const before = extractFacts(original);
  const after = extractFacts(out);
  const outLines = new Set(splitLines(out));
  if (!before.fixedLines.every((line) => outLines.has(line))) return false;
  if (!before.numbers.every((n) => after.numbers.includes(n))) return false;
  if (!after.numbers.every((n) => before.numbers.includes(n))) return false;
  if (!before.quoted.every((q) => out.includes(q))) return false;
  return before.words.every((word) => after.words.includes(word));
}

const EXAMPLES = {
  en: [
    'Original: Available times on Fri, Nov 6:\n1. 9:00 AM\n2. 10:00 AM\nReply with the number of the time. Say "other day" for another date.',
    'Rewrite: Sure, here is what I have for Fri, Nov 6:\n1. 9:00 AM\n2. 10:00 AM\nJust tell me the number you prefer, or say "other day" if you would like another date.',
  ].join("\n"),
  pt: [
    'Original: Horários disponíveis em sex., 6 de nov.:\n1. 09:00\n2. 10:00\nResponda com o número do horário. Digite "outro dia" para outra data.',
    'Rewrite: Claro! Olha o que tenho para sex., 6 de nov.:\n1. 09:00\n2. 10:00\nMe diz o número que prefere, ou escreve "outro dia" se quiser outra data.',
  ].join("\n"),
};

function systemPrompt(language: "en" | "pt", clinicName: string): string {
  return [
    `You are the receptionist of ${clinicName}. Rewrite the message to sound like a warm, natural WhatsApp message from a human, in ${LANGUAGE_NAMES[language]}.`,
    "The customer's last message is only there for tone. Do not answer it.",
    "You MUST change the wording of the sentences that are not protected lines: casual, friendly, like a real person typing on WhatsApp. Never return the message unchanged.",
    "Keep the message about as short as the original.",
    "Keep EVERY number, time, date and name exactly as written.",
    "Keep numbered list lines, and lines starting with 📅 👤 🦷, exactly as written, each on its own line.",
    'Keep the words in quotes ("more", "other day", "mais", "outro dia") and YES, NO, SIM, NÃO exactly as written.',
    "Do not add facts, offers, promises, prices or questions that are not in the original.",
    "Do not use markdown.",
    "Example of the style (only the unprotected sentences change):",
    EXAMPLES[language],
    'Return JSON: {"message": "..."}',
  ].join("\n");
}

export function createHumanizer({ ollama, language, clinicName }: { ollama: Pick<OllamaClient, "chat">; language: "en" | "pt"; clinicName: string }) {
  const system = systemPrompt(language, clinicName);

  return {
    /** Devolve a reescrita se passar na guarda; senão, ou em qualquer erro, o texto original. Nunca lança. */
    async humanize(reply: string, customerText: string, log?: Warn): Promise<string> {
      const fallback = (motivo: string) => {
        log?.warn({ motivo }, "resposta mantida no texto fixo");
        return reply;
      };
      try {
        const raw = await ollama.chat({
          format: FORMAT,
          messages: [
            { role: "system", content: system },
            { role: "user", content: `Customer said: ${customerText}\n\nMessage to rewrite: ${reply}` },
          ],
        });
        const parsed = OUTPUT.safeParse(raw);
        if (!parsed.success) return fallback("resposta fora do formato");
        if (!guardRewrite(reply, parsed.data.message)) return fallback("reescrita alterou fatos");
        return parsed.data.message.trim();
      } catch (err) {
        return fallback((err as Error).message);
      }
    },
  };
}
