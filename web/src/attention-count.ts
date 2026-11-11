/**
 * Conversas que pedem atenção do operador: estado puro, sem React.
 * O hook useAttentionCount carrega a lista e passa os eventos do SSE por aqui.
 */

export interface ConversationAttention {
  id: string;
  needsAttention: boolean;
}

export type AttentionState = ReadonlySet<string>;

export type AttentionAction =
  | { type: "loaded"; conversations: readonly ConversationAttention[] }
  | { type: "updated"; conversation: ConversationAttention }
  | { type: "deleted"; id: string }
  | { type: "cleared" };

export const NO_ATTENTION: AttentionState = new Set<string>();

/** Devolve o próprio conjunto quando nada muda, para o React não repintar à toa. */
function withId(state: AttentionState, id: string, present: boolean): AttentionState {
  if (state.has(id) === present) return state;
  const next = new Set(state);
  if (present) next.add(id);
  else next.delete(id);
  return next;
}

export function attentionReducer(state: AttentionState, action: AttentionAction): AttentionState {
  switch (action.type) {
    case "loaded":
      return new Set(action.conversations.filter((conversation) => conversation.needsAttention).map((conversation) => conversation.id));
    case "updated":
      return withId(state, action.conversation.id, action.conversation.needsAttention);
    case "deleted":
      return withId(state, action.id, false);
    case "cleared":
      return state.size === 0 ? state : NO_ATTENTION;
  }
}
