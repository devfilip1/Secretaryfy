import assert from "node:assert/strict";
import { test } from "node:test";
import { setup, SESSION } from "../../test/router-harness.js";
import { testReplies } from "../../test/clinic.js";
import { testCatalog } from "../../test/catalog.js";

const SERVICES_LIST = /^We offer these services:\n• Dental Cleaning\n[^]*\n• General assessment\nWould you like to book one of them\? Just tell me which\.$/;

test("'quais serviços vocês têm?' (list_services) responde a lista do catálogo, sem modelo e sem começar agendamento", async () => {
  const r = setup({ intent: "list_services", text: "Quais serviços você tem?" });
  const out = await r.reply();
  assert.match(out!.text, SERVICES_LIST);
  assert.equal(out!.text, testReplies.servicesList());
  assert.equal(r.handled.length, 0, "não vai ao fluxo");
  assert.equal(r.asked.length, 0, "não vai ao folheto");
  assert.equal(r.cleared.length, 0, "não mexe em agendamento algum");
});

test("a lista traz todos os tratamentos do catálogo, na ordem da tabela, com a avaliação geral no fim", async () => {
  const labels = testCatalog.list().map((s) => (s.name === "Assessment" ? "General assessment" : s.label));
  const bullets = (await setup({ intent: "list_services" }).reply())!.text.split("\n").filter((l) => l.startsWith("• ")).map((l) => l.slice(2));
  assert.deepEqual(bullets, labels);
});

test("list_services no meio de um agendamento: a lista sai e a etapa continua", async () => {
  const r = setup({ intent: "list_services", session: SESSION, text: "o que vocês fazem?" });
  assert.match((await r.reply())!.text, SERVICES_LIST);
  assert.equal(r.handled.length, 0);
  assert.equal(r.cleared.length, 0);
});

test("list_services na primeira resposta abre com a saudação, como as outras respostas", async () => {
  const r = setup({ intent: "list_services", firstMessage: true, text: "o que vocês fazem?" });
  const out = await r.reply();
  assert.match(out!.text, /^Good (morning|afternoon|evening)! You've reached DentalSafe[.]\n\nWe offer these services:/);
});

test("resposta do fluxo que já começa com a abertura e repete uma anterior não ganha outra: não sai 'Of course!' duas vezes", async () => {
  const text = "Of course! These days have openings:\n• Wednesday, October 21";
  const r = setup({ intent: "book", flowReply: text, assistantSaid: text });
  assert.equal((await r.reply())!.text, text);
});

test("resposta do folheto repetida que já começa com a abertura fica como está", async () => {
  const r = setup({ intent: "question", brochureAnswer: "Of course! It costs R$ 10.", assistantSaid: "Of course! It costs R$ 10." });
  assert.equal((await r.reply())!.text, "Of course! It costs R$ 10.");
});
