// Mede os extratores focados (horário, parte do dia, dia citado, opção pela posição) com o modelo real (Ollama).
// Cada frase nova com erro vira uma linha nas tabelas abaixo, sem if no roteador (ADR 0017).
// Uso: npx tsx --env-file=.env scripts/eval-extractors.ts
import { createClinicContext } from "../src/modules/clinic/context.js";
import { ptCatalog, testCatalog } from "../src/test/catalog.js";
import { createInterpreter, type DayPeriod } from "../src/modules/scheduling/interpret.js";
import { createOllamaClient } from "../src/modules/scheduling/ollama.js";

/** Abaixo deste percentual de acertos a rodada falha (exit 1) */
const MIN_RATE = 0.9;
/** Quantas opções a tela mostra na tabela de posições */
const OPTION_COUNT = 6;

// [frase, horário esperado (HH:MM ou null), parte do dia esperada (ou null), a frase cita um dia?]
const whenCases: [string, string | null, DayPeriod | null, boolean][] = [
  ["Meu nome é Carla. Queria marcar uma limpeza amanhã à tarde", null, "afternoon", true],
  ["Queria marcar uma limpeza amanhã à tarde", null, "afternoon", true],
  ["Quero marcar um clareamento amanhã de manhã", null, "morning", true],
  ["amanhã de manhã", null, "morning", true],
  ["tem horário à noite?", null, "evening", false],
  ["e à noite, tem?", null, "evening", false],
  ["prefiro de tarde", null, "afternoon", false],
  ["I want to book tomorrow in the morning", null, "morning", true],
  ["Hi, I'm Mark. I'd like a cleaning tomorrow afternoon", null, "afternoon", true],
  ["pode ser às 14h", "14:00", null, false],
  ["às duas da tarde", "14:00", null, false],
  ["amanhã às 9h", "09:00", null, true],
  ["3pm tomorrow works", "15:00", null, true],
  ["Meu nome é Carla, quero marcar às 10 da manhã", "10:00", null, false],
  ["Quero marcar para sexta", null, null, true],
  ["the first one", null, null, false],
  ["o primeiro", null, null, false],
  ["Meu nome é Carla. Queria marcar uma limpeza", null, null, false],
  ["pode ser meio-dia?", "12:00", null, false],
  ["umas 3 da tarde", "15:00", null, false],
  ["depois das 15h", "15:00", null, false],
  ["então quinta de manhã", null, "morning", true],
  ["quinta de manhã, se der", null, "morning", true],
  ["Obrigada, mas prefiro à noite", null, "evening", false],
  ["dia 25 às 10h", "10:00", null, true],
  ["pode ser dia 12?", null, null, true],
  ["sábado à tarde", null, "afternoon", true],
  ["hoje ainda dá?", null, null, true],
  ["sim", null, null, false],
  ["vcs abrem domingo?", null, null, true],
  ["vocês atendem no fim de semana?", null, null, true],
  ["Do you have anything tomorrow?", null, null, true],
];

// [frase, posição esperada na lista de opções (ou null)]
const optionCases: [string, number | null][] = [
  ["the first one", 1],
  ["the first one please", 1],
  ["the last one", 6],
  ["o primeiro", 1],
  ["o último", 6],
  ["o segundo", 2],
  ["pode ser o primeiro mesmo", 1],
  ["I'll take the second one", 2],
  ["the third", 3],
  ["o terceiro horário", 3],
  ["o último horário", 6],
  ["a segunda opção", 2],
  ["none of them", null],
  ["what about friday", null],
  ["sim", null],
  ["outro dia", null],
  ["tem às 16h?", null],
  ["more times please", null],
  ["quanto custa?", null],
  ["à tarde", null],
  ["obrigada", null],
  ["prefiro de manhã", null],
  ["another day please", null],
  ["mais horários", null],
  ["não", null],
  ["quinta-feira", null],
  ["Carla", null],
];

const ollama = createOllamaClient({
  url: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  model: process.env.AGENT_MODEL ?? "qwen3:8b",
  timeoutMs: Number(process.env.AGENT_TIMEOUT_MS ?? 20000),
});
// A mesma clínica e o mesmo catálogo do eval-interpret
const clinic = createClinicContext({
  name: process.env.CLINIC_NAME || "DentalSafe",
  language: process.env.CLINIC_LANGUAGE === "pt" ? "pt" : "en",
  assistantName: process.env.ASSISTANT_NAME,
  kind: process.env.CLINIC_KIND || "dental clinic",
});
const catalog = clinic.language === "pt" ? ptCatalog : testCatalog;
const interpreter = createInterpreter({ ollama, clinic, catalog });

/** Imprime o resumo de uma tabela e diz se ela passou do mínimo */
function summarize(name: string, ok: number, total: number): boolean {
  const rate = total === 0 ? 0 : ok / total;
  console.log(`\n${name}: ${ok}/${total} certos (${Math.round(rate * 100)}%)`);
  return rate >= MIN_RATE;
}

console.log("Tabela 1: mentionedWhen (horário, parte do dia, dia citado)");
let whenOk = 0;
for (const [text, time, period, namesDay] of whenCases) {
  const got = await interpreter.mentionedWhen({ text });
  const right = (got.time ?? null) === time && (got.period ?? null) === period && got.namesDay === namesDay;
  if (right) whenOk++;
  console.log(`${right ? "ok  " : "FAIL"} ${text}  ->  time=${got.time ?? "-"} period=${got.period ?? "-"} namesDay=${got.namesDay ?? "-"}${right ? "" : `   esperado time=${time ?? "-"} period=${period ?? "-"} namesDay=${namesDay}`}`);
}
const whenPassed = summarize("mentionedWhen", whenOk, whenCases.length);

console.log(`\nTabela 2: mentionedOption (posição na lista de ${OPTION_COUNT})`);
let optionOk = 0;
for (const [text, expected] of optionCases) {
  const got = await interpreter.mentionedOption({ text, count: OPTION_COUNT });
  const right = got === expected;
  if (right) optionOk++;
  console.log(`${right ? "ok  " : "FAIL"} ${text}  ->  option=${got ?? "-"}${right ? "" : `   esperado ${expected ?? "-"}`}`);
}
const optionPassed = summarize("mentionedOption", optionOk, optionCases.length);

process.exitCode = whenPassed && optionPassed ? 0 : 1;
