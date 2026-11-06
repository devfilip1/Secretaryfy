import { queryOptions } from "@tanstack/react-query";
import { getClinicSettings, knowledgeStatus, listKnowledge } from "./api";

/** Chaves do cache do conhecimento: invalidar `all` recarrega a lista e o status juntos. */
export const knowledgeKeys = {
  all: ["knowledge"] as const,
  list: () => ["knowledge", "list"] as const,
  status: () => ["knowledge", "status"] as const,
};

export const knowledgeListQuery = () =>
  queryOptions({
    queryKey: knowledgeKeys.list(),
    queryFn: listKnowledge,
  });

export const knowledgeStatusQuery = () =>
  queryOptions({
    queryKey: knowledgeKeys.status(),
    queryFn: knowledgeStatus,
  });

/** Dados da clínica (aba Clínica): invalidar `all` recarrega a leitura depois de salvar. */
export const clinicSettingsKeys = {
  all: ["clinicSettings"] as const,
  detail: () => ["clinicSettings", "detail"] as const,
};

export const clinicSettingsQuery = () =>
  queryOptions({
    queryKey: clinicSettingsKeys.detail(),
    queryFn: getClinicSettings,
  });
