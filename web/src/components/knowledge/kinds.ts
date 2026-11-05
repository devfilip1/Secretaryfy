import type { KnowledgeKind } from "../../api";

/** Nome do tipo de seção nas linhas da lista. */
export const KIND_LABEL: Record<KnowledgeKind, string> = { treatment: "Treatment", info: "Info" };

/** Nome do tipo de seção nos botões e títulos do diálogo ("Add treatment", "Edit info section"). */
export const KIND_NOUN: Record<KnowledgeKind, string> = { treatment: "treatment", info: "info section" };
