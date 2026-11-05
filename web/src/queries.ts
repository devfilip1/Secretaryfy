import { queryOptions } from "@tanstack/react-query";
import { knowledgeStatus, listKnowledge } from "./api";

/** Chaves do cache do conhecimento: invalidar `all` recarrega a lista e o status juntos. */
export const knowledgeKeys = {
  all: ["knowledge"] as const,
  list: () => ["knowledge", "list"] as const,
  status: () => ["knowledge", "status"] as const,
};

export const knowledgeListQuery = () =>
  queryOptions({
    queryKey: knowledgeKeys.list(),
    queryFn: async () => (await listKnowledge()).sections,
  });

export const knowledgeStatusQuery = () =>
  queryOptions({
    queryKey: knowledgeKeys.status(),
    queryFn: knowledgeStatus,
  });
