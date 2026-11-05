// Mede só o interpretador com o modelo real (Ollama): frases naturais, sem listas de palavras no código (specs/003, R12).
// Uso: npx tsx --env-file=.env scripts/eval-interpret.ts
import type { SessionOption } from "../src/db/schema.js";
import { createInterpreter, type Interpretation, type InterpretInput } from "../src/modules/scheduling/interpret.js";
import { createOllamaClient } from "../src/modules/scheduling/ollama.js";

// Terça, 20/10/2026, 15:00 em Salvador
const now = new Date("2026-10-20T18:00:00Z");
const timeZone = "America/Bahia";
const window = { firstDate: "2026-10-20", lastDate: "2026-11-19" };
const days: SessionOption[] = [
  { n: 1, kind: "day", date: "2026-10-21" },
  { n: 2, kind: "day", date: "2026-10-22" },
  { n: 3, kind: "day", date: "2026-10-23" },
  { n: 4, kind: "day", date: "2026-10-26" },
];
const slots: SessionOption[] = [
  { n: 1, kind: "slot", start: "2026-10-21T12:00:00.000Z" },
  { n: 2, kind: "slot", start: "2026-10-21T13:00:00.000Z" },
  { n: 3, kind: "slot", start: "2026-10-21T17:00:00.000Z" },
];

type Step = InterpretInput["step"];
interface Case {
  step: Step;
  text: string;
  /** Mais de uma intenção vale quando o fluxo trata todas do mesmo jeito (um dia citado na lista de dias) */
  intent: Interpretation["intent"] | Interpretation["intent"][];
  option?: number;
  date?: string;
}
const c = (step: Step, text: string, intent: Case["intent"], extra: { option?: number; date?: string } = {}): Case => ({ step, text, intent, ...extra });

const cases: Case[] = [
  c(null, "oi", "greeting"),
  c(null, "Oi, boa noite! tudo bem?", "greeting"),
  c(null, "hello there", "greeting"),
  c(null, "Qual seu nome?", "who_are_you"),
  c(null, "como você se chama?", "who_are_you"),
  c(null, "com quem eu falo?", "who_are_you"),
  c(null, "voces atendem aos sabados?", "availability", { date: "2026-10-24" }),
  c(null, "tem horario sab?", "availability", { date: "2026-10-24" }),
  c(null, "queria marcar uma consulta na sexta", "book", { date: "2026-10-23" }),
  c(null, "vcs abrem domingo?", "availability", { date: "2026-10-25" }),
  c(null, "quero marcar uma limpeza", "book"),
  c(null, "preciso cancelar minha consulta", "cancel"),
  c(null, "quanto custa o clareamento?", "question"),
  c(null, "obrigada, tchau!", "goodbye"),
  c("choose_day", "quero sexta", "choose", { option: 3 }),
  c("choose_day", "pode ser na quinta-feira", "choose", { option: 2 }),
  c("choose_day", "segunda", "choose", { date: "2026-10-26" }),
  c("choose_day", "o primeiro", "choose", { option: 1 }),
  c("choose_day", "o último", "choose", { option: 4 }),
  c("choose_day", "e domingo?", ["choose", "availability"], { date: "2026-10-25" }),
  c("choose_day", "prefiro outro dia", "other_day"),
  c("choose_slot", "o das 9", "choose", { option: 1 }),
  c("choose_slot", "as 10 ta bom", "choose", { option: 2 }),
  c("choose_slot", "pode ser a tarde mesmo", "choose", { option: 3 }),
  c("choose_slot", "quero ver mais horarios", "more"),
  c("choose_slot", "outro dia por favor", "other_day"),
  c("confirm_booking", "sim, pode confirmar", "yes"),
  c("confirm_booking", "isso mesmo", "yes"),
  c("confirm_booking", "nao, melhor outro horario", "no"),
  c("ask_name", "Carla Souza", "give_name"),
  c("choose_service", "quero fazer um clareamento", "choose_service"),
];

const ollama = createOllamaClient({
  url: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  model: process.env.AGENT_MODEL ?? "qwen3:8b",
  timeoutMs: Number(process.env.AGENT_TIMEOUT_MS ?? 20000),
});
const interpreter = createInterpreter({ ollama });

let ok = 0;
const latencies: number[] = [];
for (const k of cases) {
  const options = k.step === "choose_day" ? days : k.step === "choose_slot" ? slots : [];
  const started = Date.now();
  const got = await interpreter.interpret({
    text: k.text, step: k.step, options, history: [], now, timeZone, window, awaitingName: k.step === "ask_name",
  });
  latencies.push(Date.now() - started);
  const right = [k.intent].flat().includes(got.intent) && (k.option === undefined || got.option === k.option) && (k.date === undefined || got.date === k.date);
  if (right) ok++;
  console.log(`${right ? "ok  " : "FAIL"} [${k.step ?? "-"}] ${k.text}  ->  ${got.intent} option=${got.option} date=${got.date} (${got.source})${right ? "" : `   esperado ${[k.intent].flat().join("|")} option=${k.option ?? "-"} date=${k.date ?? "-"}`}`);
}
latencies.sort((a, b) => a - b);
console.log(`\n${ok}/${cases.length} certos, mediana ${latencies[Math.floor(latencies.length / 2)]} ms, máx ${latencies.at(-1)} ms`);
