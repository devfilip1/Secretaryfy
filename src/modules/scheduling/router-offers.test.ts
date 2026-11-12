import assert from "node:assert/strict";
import { test } from "node:test";
import { testCatalog } from "../../test/catalog.js";
import { setup } from "../../test/router-harness.js";
import { createClinicContext } from "../clinic/context.js";
import { ASSESSMENT, createCatalog } from "./catalog.js";
import { createReplies } from "./replies.js";

test("list_services com o retorno ligado e a avaliação desligada: a lista traz o retorno e não a avaliação", async () => {
  // A clínica liga o retorno e desliga a avaliação: a lista é a do catálogo, sem modelo e sem texto fixo do serviço
  const clinic = createClinicContext({ name: "DentalSafe", kind: "dental clinic", language: "en", offerAssessment: false, offerFollowUp: true });
  const catalog = createCatalog(testCatalog.list().filter((s) => s.name !== ASSESSMENT), clinic);
  const texts = createReplies({ clinic, catalog });
  const r = setup({ intent: "list_services", texts });
  const out = await r.reply();
  const bullets = out!.text.split("\n").filter((l) => l.startsWith("• ")).map((l) => l.slice(2));
  assert.deepEqual(bullets, [...testCatalog.list().slice(0, 8).map((s) => s.label), "Follow-up visit"]);
  assert.equal(out!.text, texts.servicesList());
  assert.doesNotMatch(out!.text, /General assessment/);
});
