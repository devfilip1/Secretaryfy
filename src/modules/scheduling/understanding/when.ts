import { z } from "zod";
import type { OllamaClient } from "../ollama.js";
import { quoted } from "./quote.js";

/** Parte do dia que o cliente pediu sem citar um horário ("de manhã", "à tarde", "à noite") */
export type DayPeriod = "morning" | "afternoon" | "evening";

const whenOutput = z.object({
  period_quote: z.string().nullable(),
  period: z.enum(["morning", "afternoon", "evening"]).nullable(),
  hour_quote: z.string().nullable(),
  time: z.string().nullable(),
  day_quote: z.string().nullable(),
});
const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;
/** O que a mensagem pede na chamada focada: um horário ou uma parte do dia, nunca os dois; e se ela cita um dia (null = não deu para saber) */
export interface When {
  time: string | null;
  period: DayPeriod | null;
  namesDay?: boolean | null;
}
const NO_WHEN: When = { time: null, period: null, namesDay: null };
// A parte do dia e o horário têm campos e citações separados: com uma citação só, o modelo lia "à tarde" como um horário
const whenFormat = {
  type: "object",
  properties: {
    period_quote: { type: ["string", "null"] },
    period: { type: ["string", "null"], enum: [null, "morning", "afternoon", "evening"] },
    hour_quote: { type: ["string", "null"] },
    time: { type: ["string", "null"], description: "HH:MM, 24 hour clock" },
    day_quote: { type: ["string", "null"] },
  },
  required: ["period_quote", "period", "hour_quote", "time", "day_quote"],
};
const WHEN_PROMPT = [
  "You read one WhatsApp message of a customer who is booking an appointment at a clinic.",
  'Step 1, "period": the part of the day the customer asks for ("de manhã", "in the morning" is "morning"; "à tarde", "in the afternoon" is "afternoon"; "à noite", "in the evening" is "evening"), or null. Copy the words into "period_quote".',
  'Step 2, "time": a clock time exists only when the message writes an hour NUMBER, in digits or in words ("14h", "9:30", "às duas", "3pm", "10 da manhã", "meio-dia" is 12:00, "noon" is 12:00). Copy those words, including the number, into "hour_quote" and answer HH:MM on a 24 hour clock. A part of the day alone ("à tarde", "de manhã", "in the morning") has no hour number, so "hour_quote" and "time" are null for it. A day, a weekday or the name of a treatment is not a time.',
  'Step 3, "day_quote": the customer\'s own words that name a day ("hoje", "amanhã", "tomorrow", "sexta", "sab", "domingo", "fim de semana", "weekend", "dia 25", "the 12th", "12/11"), or null when the message names no day. A part of the day, a clock time, an option ("the first one", "o primeiro") and the name of a treatment are not days.',
  "Do not guess.",
].join("\n");

/**
 * O horário ou a parte do dia que a mensagem pede ("as 14h", "de manhã"), numa chamada focada: o modelo preenche os campos
 * do interpretador só às vezes, e uma citação que não está na mensagem é chute. Qualquer falha vira null nos dois.
 */
export function createWhenExtractor({ ollama }: { ollama: Pick<OllamaClient, "chat"> }) {
  return async ({ text, log }: { text: string; log?: { error: (obj: object, msg: string) => void } }): Promise<When> => {
    try {
      const raw = await ollama.chat({
        format: whenFormat,
        messages: [
          { role: "system", content: WHEN_PROMPT },
          { role: "user", content: text },
        ],
      });
      const parsed = whenOutput.safeParse(raw);
      if (!parsed.success) return NO_WHEN;
      // Se a mensagem cita um dia: sem citação, a data que o modelo deu é chute (o router a descarta)
      const namesDay = quoted(text, parsed.data.day_quote);
      // Um horário válido ganha; a parte do dia só vale quando não há horário
      if (parsed.data.time && TIME_FORMAT.test(parsed.data.time) && quoted(text, parsed.data.hour_quote)) return { time: parsed.data.time, period: null, namesDay };
      return { time: null, period: parsed.data.period && quoted(text, parsed.data.period_quote) ? parsed.data.period : null, namesDay };
    } catch (err) {
      log?.error({ err: (err as Error).message }, "horário ou parte do dia citados indisponível");
      return NO_WHEN;
    }
  };
}
