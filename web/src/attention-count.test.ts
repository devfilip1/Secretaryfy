import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attentionReducer, NO_ATTENTION } from "./attention-count";

describe("attentionReducer", () => {
  it("carrega só as conversas que pedem atenção", () => {
    const state = attentionReducer(NO_ATTENTION, {
      type: "loaded",
      conversations: [
        { id: "a", needsAttention: true },
        { id: "b", needsAttention: false },
      ],
    });
    assert.deepEqual([...state], ["a"]);
  });

  it("adiciona quando a conversa passa a pedir atenção", () => {
    const state = attentionReducer(NO_ATTENTION, { type: "updated", conversation: { id: "a", needsAttention: true } });
    assert.deepEqual([...state], ["a"]);
  });

  it("tira quando a conversa deixa de pedir atenção", () => {
    const withA = attentionReducer(NO_ATTENTION, { type: "updated", conversation: { id: "a", needsAttention: true } });
    const state = attentionReducer(withA, { type: "updated", conversation: { id: "a", needsAttention: false } });
    assert.equal(state.size, 0);
  });

  it("apaga a conversa apagada, sem mexer nas outras", () => {
    const loaded = attentionReducer(NO_ATTENTION, {
      type: "loaded",
      conversations: [
        { id: "a", needsAttention: true },
        { id: "b", needsAttention: true },
      ],
    });
    const state = attentionReducer(loaded, { type: "deleted", id: "a" });
    assert.deepEqual([...state], ["b"]);
  });

  it("zera com conversations.cleared", () => {
    const loaded = attentionReducer(NO_ATTENTION, { type: "updated", conversation: { id: "a", needsAttention: true } });
    assert.equal(attentionReducer(loaded, { type: "cleared" }).size, 0);
  });

  it("devolve o mesmo conjunto quando nada muda e não altera o anterior", () => {
    const before = attentionReducer(NO_ATTENTION, { type: "updated", conversation: { id: "a", needsAttention: true } });
    assert.equal(attentionReducer(before, { type: "updated", conversation: { id: "a", needsAttention: true } }), before);
    assert.equal(attentionReducer(before, { type: "deleted", id: "zz" }), before);
    const after = attentionReducer(before, { type: "updated", conversation: { id: "b", needsAttention: true } });
    assert.deepEqual([...before], ["a"]);
    assert.deepEqual([...after].sort(), ["a", "b"]);
  });
});
