import assert from "node:assert/strict";
import { test } from "node:test";
import { INTENT_GROUPS, INTENTS, type Intent } from "./intents.js";

/** Os membros de cada grupo: mudar um grupo é uma edição deliberada aqui */
const EXPECTED: Record<keyof typeof INTENT_GROUPS, Intent[]> = {
  ASKS_FOR_WHEN: ["book", "availability", "reschedule"],
  CAN_CARRY_A_WHEN: ["choose", "book", "availability", "reschedule"],
  STEP_ONLY: ["choose", "more", "other_day", "choose_service"],
  STARTS_SCHEDULING: ["book", "availability", "cancel", "reschedule", "my_appointment"],
  PICKS_OFFERED_DAY: ["choose", "other_day"],
  CHOICE_LIKE: ["more", "unclear", "other_day", "availability"],
  TOO_FAR: ["availability", "choose", "book"],
  ASKS_PERIOD_OF_SCREEN: ["choose", "availability"],
  MAY_BE_NOISE: ["rude", "manipulation", "off_topic"],
};

test("INTENTS não tem duplicados", () => {
  assert.equal(new Set(INTENTS).size, INTENTS.length);
});

test("todo membro de cada grupo está em INTENTS", () => {
  for (const [name, group] of Object.entries(INTENT_GROUPS)) {
    for (const intent of group) assert.ok(INTENTS.includes(intent), `${name}: ${intent}`);
  }
});

test("cada grupo tem exatamente os membros esperados", () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual([...INTENT_GROUPS[name as keyof typeof INTENT_GROUPS]], expected, name);
  }
});
