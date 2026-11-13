import assert from "node:assert/strict";
import { test } from "node:test";
import { testCatalog } from "../../../test/catalog.js";
import { useFlowHarness } from "../../../test/flow-harness.js";
import { createClinicContext, type ClinicContext } from "../../clinic/context.js";
import type { KnowledgeRow } from "../../knowledge/types.js";
import { ASSESSMENT, createKnowledgeCatalog, FOLLOW_UP, type ServiceOffers } from "../catalog.js";
import { createReplies } from "../replies.js";

const h = useFlowHarness();
const { say, conversation, I, sessionOf, allAppointments } = h;

/** Os oito tratamentos dos testes, como linhas da tabela de conhecimento (sem a avaliação, que não é tratamento). */
const ROWS = testCatalog
  .list()
  .filter((s) => s.name !== ASSESSMENT)
  .map((s, i) => ({ key: s.name, kind: "treatment", title: s.label, tagline: null, position: i, data: { facts: [] } }) as unknown as KnowledgeRow);

/**
 * O catálogo ao vivo, como em produção: lê as ofertas da clínica a cada chamada. O fluxo e os textos são refeitos com ele;
 * depois disso, a troca nas ofertas (`clinic.update`) vale sem refazer nada.
 */
async function useClinic(settings: Partial<ServiceOffers> = {}): Promise<ClinicContext> {
  const clinic = createClinicContext({ name: "DentalSafe", kind: "dental clinic", language: "en", ...settings });
  const catalog = createKnowledgeCatalog({ repo: { list: async () => ROWS }, clinic });
  await catalog.refresh();
  h.catalog = catalog;
  h.flow = h.makeFlow(createReplies({ clinic, catalog }));
  return clinic;
}

test("com a avaliação desligada, a lista não a traz e a escolha de serviço pergunta de novo, sem assumir a avaliação", async () => {
  await useClinic({ offerAssessment: false });
  const conv = await conversation();
  h.mentioned = null;
  const asked = await say(conv, I("book"));
  assert.doesNotMatch(asked.reply, /Not sure|Avaliação geral|General assessment/);
  assert.match(asked.reply, /\n• Dental Cleaning\n/);
  assert.equal((await sessionOf(conv))!.options.length, 8, "só os oito tratamentos");

  const again = await say(conv, I("choose_service", { service: ASSESSMENT }));
  assert.equal(again.reply, asked.reply, "a avaliação não oferecida não é aceita: a pergunta volta");
  const session = await sessionOf(conv);
  assert.equal(session!.step, "choose_service");
  assert.equal(session!.service, null);
  assert.equal(h.fake.calls.createEvent, 0);
});

test("a avaliação escolhida e depois desligada não é presumida no resumo: pergunta o serviço de novo e nada é marcado", async () => {
  const clinic = await useClinic({ offerAssessment: true });
  const conv = await conversation();
  h.mentioned = null;
  await say(conv, I("book"));
  await say(conv, I("choose_service", { service: ASSESSMENT }));
  await say(conv, I("choose", { option: 2 }));
  const summary = await say(conv, I("choose", { option: 2 }));
  assert.match(summary.reply, /General assessment/);

  clinic.update({ offerAssessment: false });
  const asked = await say(conv, I("yes"));
  assert.doesNotMatch(asked.reply, /You're booked/);
  assert.match(asked.reply, /\n• Dental Cleaning\n/);
  const session = await sessionOf(conv);
  assert.equal(session!.step, "choose_service");
  assert.ok(session!.selectedStart, "o horário escolhido fica guardado para o próximo passo");
  assert.equal(h.fake.calls.createEvent, 0);
  assert.equal((await allAppointments()).length, 0);
});

test("retorno ligado: aparece na lista, e escolhido leva o próprio tempo (45 min) para a agenda e para o agendamento", async () => {
  await useClinic({ offerFollowUp: true, followUpMinutes: 45 });
  const conv = await conversation();
  h.mentioned = null;
  const asked = await say(conv, I("book"));
  assert.match(asked.reply, /\n• Follow-up visit\n/);
  const options = (await sessionOf(conv))!.options;
  assert.equal(options.length, 10, "oito tratamentos, o retorno e a avaliação");
  assert.equal(options[8].n, 9);

  await say(conv, I("choose_service", { service: FOLLOW_UP }));
  await say(conv, I("choose", { option: 2 }));
  const confirm = await say(conv, I("choose", { option: 2 }));
  assert.match(confirm.reply, /\(45 min\)/);
  assert.match(confirm.reply, /Follow-up visit/);

  await say(conv, I("yes"));
  const [event] = [...h.fake.events.values()];
  assert.equal(event.end.getTime() - event.start.getTime(), 45 * 60_000);
  const [appt] = await allAppointments();
  assert.equal(appt.service, FOLLOW_UP);
});

test("retorno citado na conversa vai direto aos dias, com o tempo do retorno", async () => {
  await useClinic({ offerFollowUp: true, followUpMinutes: 45 });
  const conv = await conversation();
  h.mentioned = FOLLOW_UP;
  await say(conv, I("book"));
  const session = await sessionOf(conv);
  assert.equal(session!.step, "choose_day");
  assert.equal(session!.service, FOLLOW_UP);
  assert.equal(h.catalog.minutes(FOLLOW_UP), 45);
});

test("avaliação geral citada na conversa vai direto aos dias, sem perguntar o serviço", async () => {
  await useClinic({ offerAssessment: true });
  const conv = await conversation();
  h.mentioned = ASSESSMENT;
  await say(conv, I("book"));
  const session = await sessionOf(conv);
  assert.equal(session!.step, "choose_day");
  assert.equal(session!.service, ASSESSMENT);
});

test("a troca nas ofertas vale na mensagem seguinte, sem refazer o fluxo", async () => {
  const clinic = await useClinic({ offerAssessment: true });
  const first = await conversation();
  h.mentioned = null;
  assert.match((await say(first, I("book"))).reply, /\n• Not sure \(general assessment\)\n/);

  clinic.update({ offerAssessment: false, offerFollowUp: true });
  const second = await conversation("5571888888888");
  const asked = await say(second, I("book"));
  assert.match(asked.reply, /Follow-up visit/);
  assert.doesNotMatch(asked.reply, /Not sure|General assessment/);
});

