import assert from "node:assert/strict";
import { test } from "node:test";
import { createHumanizer, guardRewrite } from "./humanize.js";
import { InterpreterUnavailable, type ChatMessage } from "./ollama.js";
import { testCatalog } from "../../test/catalog.js";
import { createReplies } from "./replies.js";

const SLOTS = [new Date("2026-10-21T13:00:00Z"), new Date("2026-10-21T13:30:00Z"), new Date("2026-10-21T14:00:00Z")];
const TZ = "America/Bahia";

const en = createReplies({ language: "en", clinic: { name: "DentalSafe" }, catalog: testCatalog }).offerSlots("2026-10-21", SLOTS, TZ, true);
const pt = createReplies({ language: "pt", clinic: { name: "DentalSafe" }, catalog: testCatalog }).offerSlots("2026-10-21", SLOTS, TZ, true);

/** Reescrita fiel: acrescenta uma frase e mantém o resto (listas, números e aspas) como estão. */
const faithful = (original: string) => `Oi! ${original}`;

test("aceita a reescrita fiel de uma lista de horários, em inglês e português", () => {
  for (const original of [en, pt]) {
    assert.equal(guardRewrite(original, faithful(original)), true);
  }
});

test("recusa horário trocado", () => {
  const rewrite = en.replace("• 10:00 AM", "• 10:15 AM");
  assert.notEqual(rewrite, en);
  assert.equal(guardRewrite(en, rewrite), false);
  assert.equal(guardRewrite(en, faithful(en).replace(/\d+:\d+/, "11:45")), false);
});

test("recusa linha numerada descartada", () => {
  const numbered = 'Available times:\n1. 9:00 AM\n2. 10:00 AM\nReply with the number of the time.';
  const rewrite = numbered
    .split("\n")
    .filter((line) => !line.startsWith("1. "))
    .join("\n");
  assert.equal(guardRewrite(numbered, rewrite), false);
  assert.equal(guardRewrite(numbered, faithful(numbered)), true);
});

test("recusa linha com bolinha (•) descartada", () => {
  const rewrite = en
    .split("\n")
    .filter((line) => !line.startsWith("• 10:00 AM"))
    .join("\n");
  assert.notEqual(rewrite, en);
  assert.equal(guardRewrite(en, rewrite), false);
});

test("recusa número inventado", () => {
  assert.equal(guardRewrite(en, `${faithful(en)} Ring us 99 times.`), false);
});

test("recusa quando some a palavra entre aspas", () => {
  const original = `${en} Say "more" for more times.`;
  const rewrite = original.replace('"more"', "more");
  assert.notEqual(rewrite, original);
  assert.equal(guardRewrite(original, rewrite), false);
});

test("recusa markdown", () => {
  assert.equal(guardRewrite(en, `**Oi!** ${en}`), false);
  assert.equal(guardRewrite(en, `${en}\n\`\`\`code\`\`\``), false);
  assert.equal(guardRewrite(en, `# Oi\n${en}`), false);
});

test("recusa reescrita longa demais", () => {
  assert.equal(guardRewrite(en, `${en} ${"word ".repeat(200)}`), false);
});

test("recusa reescrita vazia", () => {
  assert.equal(guardRewrite(en, ""), false);
  assert.equal(guardRewrite(en, "   "), false);
});

test("recusa quando some SIM ou NÃO presente no original", () => {
  const original = "Responda SIM para confirmar ou NÃO para cancelar.";
  assert.equal(guardRewrite(original, "Responda para confirmar ou cancelar."), false);
  assert.equal(guardRewrite(original, "Responda SIM para confirmar ou não para cancelar."), true);
});

test("humanize: cai no original quando o modelo lança erro", async () => {
  const humanizer = createHumanizer({
    ollama: { chat: async () => Promise.reject(new InterpreterUnavailable("fora do ar")) },
    language: "en",
    clinic: { name: "DentalSafe" },
  });
  assert.equal(await humanizer.humanize(en, "hi"), en);
});

test("humanize: cai no original quando o modelo devolve null ou fora do formato", async () => {
  for (const raw of [null, { other: 1 }]) {
    const humanizer = createHumanizer({ ollama: { chat: async () => raw }, language: "en", clinic: { name: "DentalSafe" }, catalog: testCatalog });
    assert.equal(await humanizer.humanize(en, "hi"), en);
  }
});

test("humanize: cai no original quando a reescrita falha na guarda", async () => {
  const humanizer = createHumanizer({
    ollama: { chat: async () => ({ message: "Sure! Pick 1 or 2 for 99 o'clock." }) },
    language: "en",
    clinic: { name: "DentalSafe" },
  });
  assert.equal(await humanizer.humanize(en, "hi"), en);
});

test("humanize: devolve a reescrita quando passa na guarda", async () => {
  const rewrite = faithful(en);
  const humanizer = createHumanizer({ ollama: { chat: async () => ({ message: rewrite }) }, language: "en", clinic: { name: "DentalSafe" }, catalog: testCatalog });
  assert.equal(await humanizer.humanize(en, "hi"), rewrite);
});

test("humanize: o prompt leva o nome da clínica e a língua certa", async () => {
  const seen: ChatMessage[][] = [];
  const chat = async ({ messages }: { messages: ChatMessage[] }) => {
    seen.push(messages);
    return { message: pt };
  };
  await createHumanizer({ ollama: { chat }, language: "pt", clinic: { name: "Clínica Sorriso" } }).humanize(pt, "oi, tudo bem?");
  const [system, user] = seen[0];
  assert.equal(system.role, "system");
  assert.match(system.content, /Clínica Sorriso/);
  assert.match(system.content, /Brazilian Portuguese/);
  assert.match(user.content, /Customer said: oi, tudo bem\?/);
  assert.match(user.content, /Message to rewrite:/);
});
