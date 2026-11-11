import assert from "node:assert/strict";
import { test } from "node:test";
import { createClinicContext } from "../../clinic/context.js";
import { createReplies } from "../replies.js";
import { testCatalog } from "../../../test/catalog.js";
import { useFlowHarness } from "../../../test/flow-harness.js";

const h = useFlowHarness();
const { say, conversation, I, sessionOf, systemNotes, hasNote, book, makeFlow } = h;

test("duas respostas não entendidas seguidas: handoff, pausa e destaque (FR-024a)", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  const first = await say(conv, I("unclear"));
  assert.match(first.reply, /^Sorry, I didn't get that\. These days have openings:\n• Tuesday, October 20/);
  assert.equal((await sessionOf(conv))?.misunderstoodCount, 1);

  // Uma resposta entendida no meio zera o contador
  await say(conv, I("choose", { option: 2 }));
  assert.equal((await sessionOf(conv))?.misunderstoodCount, 0);
  await say(conv, I("unclear"));
  const second = await say(conv, I("unclear"));
  assert.equal(second.handoff, true);
  assert.match(second.reply, /Someone from our team will continue with you/);

  const after = (await h.repo.findConversation(conv.id))!;
  assert.equal(after.assistantPaused, true);
  assert.equal(after.needsAttention, true);
  assert.equal(await sessionOf(conv), null);
  assert.ok(hasNote(await systemNotes(conv), { kind: "handoff" }));
});

test("yes fora de uma pergunta de sim ou não conta como não entendido", async () => {
  const conv = await conversation();
  await say(conv, I("availability"));
  assert.match((await say(conv, I("yes"))).reply, /^Sorry, I didn't get that/);
});

test("stop encerra o fluxo", async () => {
  const conv = await conversation();
  await say(conv, I("book"));
  assert.equal((await say(conv, I("stop"))).reply, "No problem. Let me know if you'd like to book later.");
  assert.equal(await sessionOf(conv), null);
});

// --- Português: os mesmos fluxos, com os textos da clínica em português ---

test("em português: a conversa de marcar sai na língua da clínica, do primeiro texto ao horário marcado", async () => {
  const clinic = createClinicContext({ name: "Clínica Sorriso", kind: "clínica odontológica", language: "pt" });
  h.flow = makeFlow(createReplies({ clinic, catalog: testCatalog }));
  const conv = await conversation();
  const offer = await say(conv, I("availability"));
  assert.match(offer.reply, /Tenho horários livres nestes dias:/);
  const done = await book(conv);
  assert.match(done.reply, /seu horário está marcado/);
  assert.match(done.reply, /Clínica Sorriso/);
});
