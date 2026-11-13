import assert from "node:assert/strict";
import { test } from "node:test";
import { at, useFlowHarness } from "../../../test/flow-harness.js";
import type { TimeWindow } from "../interpret.js";

const h = useFlowHarness();
const { say, conversation, I, sessionOf } = h;

// Quinta, 19/11/2026. Horários cheios das 9h às 17h. Com o dia ocupado das 15h, os horários vão das 9h às 14h.
const TAIL_NO_MORE = "I can also check another day if you like.";
const TAIL_MORE = "I can show more times or another day if you like.";
const NONE_IN_WINDOW =
  /^Unfortunately we have no time like that on Thursday, November 19\. The closest times are:\n• 9:00 AM\n• 10:00 AM\n• 11:00 AM\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\nI can also check another day if you like\.$/;

type Row = { name: string; open?: boolean; window: TimeWindow; expected: RegExp; intent?: "choose" | "more" | "availability" };

/** Dia com o fim às 14h (ocupado das 15h): a tela e a janela trabalham com 9h a 14h */
const CLOSED_AFTER_14: Row[] = [
  { name: "depois das 11h: só o que vem depois", window: { notBefore: "11:00" }, expected: /^On Thursday, November 19 I have these times:\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\nWhich one would you like\? I can also check another day if you like\.$/ },
  { name: "antes das 11h: 9h e 10h, em ordem", window: { notAfter: "11:00" }, expected: /^On Thursday, November 19 I have these times:\n• 9:00 AM\n• 10:00 AM\nWhich one would you like\?/ },
  { name: "mais cedo que 9h: nada antes do primeiro horário", window: { notAfter: "09:00" }, expected: NONE_IN_WINDOW },
  { name: "mais cedo, relativo ao primeiro na tela", window: { notAfter: "first" }, expected: NONE_IN_WINDOW },
  { name: "mais tarde, relativo ao último na tela: nada depois", window: { notBefore: "last" }, expected: NONE_IN_WINDOW },
  { name: "depois das 14h: nada depois", window: { notBefore: "14:00" }, expected: NONE_IN_WINDOW },
  { name: "entre 12h e 14h: só as 13h", window: { notBefore: "12:00", notAfter: "14:00" }, expected: /^On Thursday, November 19 I have these times:\n• 1:00 PM\nWhich one would you like\? I can also check another day if you like\.$/ },
  { name: "o último horário: a ponta da janela", window: { pick: "latest" }, expected: /^On Thursday, November 19 I have these times:\n• 9:00 AM\n• 10:00 AM\n• 11:00 AM\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\nWhich one would you like\? I can also check another day if you like\.$/ },
  { name: "perto das 13h, com a intenção mais", window: { near: "13:00" }, intent: "more", expected: /^On Thursday, November 19 I have these times:\n• 9:00 AM\n• 10:00 AM\n• 11:00 AM\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\nWhich one would you like\? I can also check another day if you like\.$/ },
];

/** Dia inteiro livre (9h a 17h): a tela tem 9h a 14h e ainda sobram 15h, 16h e 17h */
const OPEN_DAY: Row[] = [
  { name: "mais tarde, depois do último na tela", open: true, window: { notBefore: "last" }, expected: /^On Thursday, November 19 I have these times:\n• 3:00 PM\n• 4:00 PM\n• 5:00 PM\nWhich one would you like\? I can also check another day if you like\.$/ },
  { name: "depois das 16h: só as 17h", open: true, window: { notBefore: "16:00" }, expected: /^On Thursday, November 19 I have these times:\n• 5:00 PM\nWhich one would you like\? I can also check another day if you like\.$/ },
  { name: "perto das 13h, de todo o dia", open: true, window: { near: "13:00" }, expected: new RegExp(`^On Thursday, November 19 I have these times:\\n• 10:00 AM\\n• 11:00 AM\\n• 12:00 PM\\n• 1:00 PM\\n• 2:00 PM\\n• 3:00 PM\\nWhich one would you like\\? ${TAIL_MORE.replace(/\./g, "\\.")}$`) },
  { name: "o último horário do dia: as seis últimas, com mais", open: true, window: { pick: "latest" }, expected: new RegExp(`^On Thursday, November 19 I have these times:\\n• 12:00 PM\\n• 1:00 PM\\n• 2:00 PM\\n• 3:00 PM\\n• 4:00 PM\\n• 5:00 PM\\nWhich one would you like\\? ${TAIL_MORE.replace(/\./g, "\\.")}$`) },
  { name: "antes das 12h, com a intenção de disponibilidade: 9h, 10h e 11h", open: true, window: { notAfter: "12:00" }, intent: "availability", expected: /^On Thursday, November 19 I have these times:\n• 9:00 AM\n• 10:00 AM\n• 11:00 AM\nWhich one would you like\? I can also check another day if you like\.$/ },
  { name: "depois das 17h: nada, e os mais perto (as últimas seis)", open: true, window: { notBefore: "17:00" }, expected: /^Unfortunately we have no time like that on Thursday, November 19\. The closest times are:\n• 12:00 PM\n• 1:00 PM\n• 2:00 PM\n• 3:00 PM\n• 4:00 PM\n• 5:00 PM\nI can also check another day if you like\.$/ },
];

async function windowReply(row: Row) {
  h.now = at("2026-11-12T10:00");
  if (!row.open) h.fake.block(at("2026-11-19T15:00"), at("2026-11-19T18:00"));
  const conv = await conversation();
  await say(conv, I("availability", { date: "2026-11-19" }));
  const { reply } = await say(conv, I(row.intent ?? "choose", { timeWindow: row.window }));
  return { reply, conv };
}

for (const row of [...CLOSED_AFTER_14, ...OPEN_DAY]) {
  test(`janela de horários: ${row.name}`, async () => {
    const { reply, conv } = await windowReply(row);
    assert.match(reply, row.expected);
    assert.equal((await sessionOf(conv))?.step, "choose_slot");
  });
}

test("janela num dia sem nenhum horário livre: o caminho do dia, sem lista de horários", async () => {
  h.now = at("2026-11-12T10:00");
  h.fake.block(at("2026-11-19T09:00"), at("2026-11-19T18:00"));
  const conv = await conversation();
  const { reply } = await say(conv, I("availability", { date: "2026-11-19", timeWindow: { notAfter: "10:00" } }));
  assert.doesNotMatch(reply, /• \d+:\d\d/);
});
