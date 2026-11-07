import assert from "node:assert/strict";
import { test } from "node:test";
import { testCatalog } from "../../test/catalog.js";
import { createInterpreter } from "../scheduling/interpret.js";
import type { ChatMessage } from "../scheduling/ollama.js";
import { createReplies } from "../scheduling/replies.js";
import { createClinicContext } from "./context.js";

test("lê a identidade inicial e a língua", () => {
  const clinic = createClinicContext({ name: "Sorriso Pleno", assistantName: "Ana", kind: "dental clinic", language: "pt" });
  assert.deepEqual([clinic.name, clinic.assistantName, clinic.kind, clinic.language], ["Sorriso Pleno", "Ana", "dental clinic", "pt"]);
});

test("assistantName vazio vira undefined: a saudação cita só a clínica", () => {
  const clinic = createClinicContext({ name: "DentalSafe", assistantName: "", kind: "dental clinic", language: "en" });
  assert.equal(clinic.assistantName, undefined);
});

test("update troca nome, nome da atendente e tipo no mesmo objeto; a língua não muda", () => {
  const clinic = createClinicContext({ name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "en" });
  clinic.update({ name: "Smile Clinic", assistantName: "", kind: "physiotherapy clinic" });
  assert.deepEqual([clinic.name, clinic.assistantName, clinic.kind, clinic.language], ["Smile Clinic", undefined, "physiotherapy clinic", "en"]);
});

test("update com assistantName undefined tira o nome da atendente (o banco pode não ter um)", () => {
  const clinic = createClinicContext({ name: "DentalSafe", assistantName: "Ana", kind: "dental clinic", language: "en" });
  clinic.update({ name: "Smile Clinic", assistantName: undefined });
  assert.equal(clinic.assistantName, undefined);
  assert.equal(clinic.name, "Smile Clinic");
});

test("a troca de nome chega à próxima saudação e ao prompt do interpretador, sem recriar nada", async () => {
  const clinic = createClinicContext({ name: "DentalSafe", kind: "dental clinic", language: "en" });
  const replies = createReplies({ language: "en", clinic, catalog: testCatalog });
  const seen: ChatMessage[][] = [];
  const interpreter = createInterpreter({
    clinic,
    catalog: testCatalog,
    ollama: { chat: async ({ messages }: { messages: ChatMessage[] }) => (seen.push(messages), { intent: "unclear", service: null }) } as never,
  });
  const input = {
    text: "tell me about teeth whitening prices",
    step: null,
    options: [],
    history: [],
    now: new Date("2026-10-20T12:00:00Z"),
    timeZone: "America/Sao_Paulo",
    window: { firstDate: "2026-10-20", lastDate: "2026-11-20" },
    awaitingName: false,
  };

  assert.match(replies.greeting(10), /You've reached DentalSafe/);
  await interpreter.interpret(input);
  assert.match(seen[0][0].content, /of DentalSafe/);

  clinic.update({ name: "Smile Clinic" });
  assert.match(replies.greeting(10), /You've reached Smile Clinic/);
  assert.doesNotMatch(replies.greeting(10), /DentalSafe/);
  await interpreter.interpret(input);
  assert.match(seen[1][0].content, /of Smile Clinic/);
  assert.doesNotMatch(seen[1][0].content, /DentalSafe/);
});
