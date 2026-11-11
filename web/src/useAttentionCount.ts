import { useCallback, useEffect, useReducer } from "react";
import { listConversations } from "./api";
import { attentionReducer, NO_ATTENTION } from "./attention-count";
import { useInboxEvents } from "./useEvents";

/** Quantas conversas pedem atenção: carrega a lista ao montar e segue os eventos do SSE. Precisa estar dentro do EventsContext. */
export function useAttentionCount(): number {
  const [attention, dispatch] = useReducer(attentionReducer, NO_ATTENTION);

  const load = useCallback(() => {
    listConversations()
      .then(({ conversations }) => dispatch({ type: "loaded", conversations }))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  useInboxEvents((event) => {
    if (event.type === "conversation.updated") dispatch({ type: "updated", conversation: event.conversation });
    if (event.type === "conversation.deleted") dispatch({ type: "deleted", id: event.id });
    if (event.type === "conversations.cleared") dispatch({ type: "cleared" });
    // Depois de uma queda o SSE pode ter perdido eventos: busca a lista de novo
    if (event.type === "reconnected") load();
  });

  return attention.size;
}
