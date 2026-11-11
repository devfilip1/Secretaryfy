import assert from "node:assert/strict";
import { test } from "node:test";
import type { SchedulingSessionRow } from "../../db/schema.js";
import { setup, SESSION } from "../../test/router-harness.js";

test("o tratamento que o modelo viu na conversa vai para o agendamento (specs/005 US2)", async () => {
  const r = setup({ intent: "book", service: "Braces and Orthodontic Treatment" });
  await r.reply();
  assert.equal(r.handled[0].mentionedService, "Braces and Orthodontic Treatment");
  // Sem serviço na interpretação, o texto não é lido por palavras
  const none = setup({ intent: "book", text: "I want braces" });
  await none.reply();
  assert.equal(none.handled[0].mentionedService, null);
});

// --- Tratamento citado na conversa (specs/005 US2): o interpretador só é consultado quando falta ---

test("sem tratamento na interpretação nem na sessão, o interpretador é consultado uma vez e o resultado vai ao fluxo", async () => {
  const r = setup({
    intent: "book",
    mentioned: "Dental Cleaning",
    history: [
      { role: "user", content: "Do you do dental cleaning?" },
      { role: "assistant", content: "Yes." },
    ],
  });
  await r.reply();
  assert.equal(r.mentionCalls.length, 1);
  assert.equal(r.mentionCalls[0].text, "How much are braces?");
  assert.deepEqual(r.mentionCalls[0].history.map((m) => m.content), ["Do you do dental cleaning?", "Yes."]);
  assert.equal(r.handled[0].mentionedService, "Dental Cleaning");
});

test("com tratamento na interpretação, o interpretador não é consultado e o dela vai ao fluxo", async () => {
  const r = setup({ intent: "book", service: "Braces and Orthodontic Treatment", mentioned: "Dental Cleaning" });
  await r.reply();
  assert.equal(r.mentionCalls.length, 0);
  assert.equal(r.handled[0].mentionedService, "Braces and Orthodontic Treatment");
});

test("com tratamento já na sessão, o interpretador não é consultado", async () => {
  const r = setup({ intent: "book", session: { ...SESSION, service: "Teeth Whitening" } as SchedulingSessionRow, mentioned: "Dental Cleaning" });
  await r.reply();
  assert.equal(r.mentionCalls.length, 0);
});

test("fora de um agendamento (dúvida), o interpretador não é consultado; dentro, sem tratamento, é", async () => {
  const q = setup({ intent: "question", mentioned: "Dental Cleaning" });
  await q.reply();
  assert.equal(q.mentionCalls.length, 0);

  const inFlow = setup({ intent: "choose", session: SESSION, mentioned: "Dental Cleaning" });
  await inFlow.reply();
  assert.equal(inFlow.mentionCalls.length, 1);
});

test("só uma parte da resposta do folheto é repetida: a parte repetida fica de fora, sem abertura", async () => {
  const r = setup({ intent: "question", assistantSaid: "Convite final.", brochureAnswer: "Custa R$ 10.\n\nConvite final." });
  const out = await r.reply();
  assert.equal(out!.text, "Custa R$ 10.");
});

test("parte do dia pedida: a chamada focada manda, o horário inventado pelo modelo some e o fluxo recebe a parte do dia", async () => {
  const r = setup({ intent: "availability", time: "09:00", when: { time: null, period: "morning" }, text: "amanhã de manhã, tem horário?" });
  await r.reply();
  assert.equal(r.whenCalls.length, 1);
  assert.equal(r.handled[0].interpretation.period, "morning");
  assert.equal(r.handled[0].interpretation.time, null);
});

test("remarcar: a chamada focada roda para a intenção e a parte do dia que ela acha chega ao fluxo", async () => {
  const r = setup({ intent: "reschedule", when: { time: null, period: "afternoon", namesDay: true }, text: "Preciso remarcar, pode ser na sexta à tarde?" });
  await r.reply();
  assert.equal(r.whenCalls.length, 1);
  assert.equal(r.handled[0].interpretation.period, "afternoon");
});

test("horário citado: a chamada focada devolve o horário e o fluxo o recebe, sem parte do dia", async () => {
  const r = setup({ intent: "availability", when: { time: "15:00", period: null }, text: "amanhã às 15h" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.time, "15:00");
  assert.equal(r.handled[0].interpretation.period ?? null, null);
});

test("sem a chamada focada achar nada, o horário do próprio interpretador vale", async () => {
  const r = setup({ intent: "book", time: "14:00", when: null, text: "quero marcar sexta as 14h" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.time, "14:00");
});

const SLOTS_ON_SCREEN = { ...SESSION, step: "choose_slot", options: [{ n: 1, kind: "slot", start: "2026-10-21T12:00:00.000Z" }] } as SchedulingSessionRow;

test("com os horários na tela, a parte do dia lida como \"mais\", \"não entendi\" ou \"outro dia\" vira escolha e o fluxo recebe a parte do dia", async () => {
  for (const intent of ["more", "unclear", "availability", "other_day"] as const) {
    const r = setup({ intent, session: SLOTS_ON_SCREEN, when: { time: null, period: "evening" }, text: "prefiro à noite" });
    await r.reply();
    assert.equal(r.handled[0].interpretation.intent, "choose");
    assert.equal(r.handled[0].interpretation.period, "evening");
  }
});

test("sem os horários na tela, a parte do dia não muda a intenção lida", async () => {
  const r = setup({ intent: "other_day", session: SESSION, when: { time: null, period: "evening" }, text: "outro dia, à noite" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "other_day");
});

test("a data que o modelo deu sem a mensagem citar um dia é chute: some, e o dia da tela vale", async () => {
  const r = setup({ intent: "choose", session: SLOTS_ON_SCREEN, date: "2026-11-14", when: { time: null, period: "evening", namesDay: false }, text: "e à noite, tem?" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.date, null);
  assert.equal(r.handled[0].interpretation.period, "evening");
});

test("a data fica quando a mensagem cita um dia, ou quando a chamada focada não soube dizer", async () => {
  for (const namesDay of [true, null]) {
    const r = setup({ intent: "availability", date: "2026-11-12", when: { time: null, period: "morning", namesDay }, text: "então quinta de manhã" });
    await r.reply();
    assert.equal(r.handled[0].interpretation.date, "2026-11-12");
  }
});

test("com opções na tela e nenhuma lida, a chamada focada acha a posição escolhida", async () => {
  const r = setup({ intent: "choose", session: SLOTS_ON_SCREEN, pick: 1, date: "2026-10-21", when: { time: null, period: null, namesDay: false }, text: "the first one" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.option, 1);
  assert.equal(r.handled[0].interpretation.date, null);
});

test("sem posição achada, a escolha continua sem opção; com horário citado, a chamada focada nem é usada", async () => {
  const none = setup({ intent: "choose", session: SLOTS_ON_SCREEN, pick: null, text: "hmm" });
  await none.reply();
  assert.equal(none.handled[0].interpretation.option, null);
  const timed = setup({ intent: "choose", session: SLOTS_ON_SCREEN, pick: 2, time: "10:00", text: "pode ser as 10" });
  await timed.reply();
  assert.equal(timed.handled[0].interpretation.option, null);
});

test("a chamada focada que rodou e não achou horário vale mais que o horário inventado pelo modelo principal", async () => {
  const r = setup({ intent: "availability", time: "10:00", when: { time: null, period: null, namesDay: true }, text: "Do you have anything tomorrow?" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.time ?? null, null);
});

test("uma escolha lida como \"não entendi\" com a posição na mensagem vira escolha dessa opção", async () => {
  const r = setup({ intent: "unclear", session: SLOTS_ON_SCREEN, pick: 2, text: "o segundo" });
  await r.reply();
  assert.equal(r.handled[0].interpretation.intent, "choose");
  assert.equal(r.handled[0].interpretation.option, 2);
});

test("palavras sem sentido lidas como grosseria viram não entendi; uma grosseria de verdade continua", async () => {
  const gibberish = setup({ intent: "rude", session: SESSION, sense: true, text: "macaco roxo lava louça" });
  await gibberish.reply();
  assert.equal(gibberish.handled[0].interpretation.intent, "unclear");
  const insult = setup({ intent: "rude", session: SESSION, sense: false, text: "vai se ferrar, robô inútil" });
  await insult.reply();
  assert.equal(insult.handled.length, 0, "a grosseria de verdade segue para a resposta fixa, sem o fluxo");
});
