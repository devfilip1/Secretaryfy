import { z } from "zod";

/** Um rótulo e o seu valor, como "Preço: R$ 40 a R$ 85". O rótulo é o texto da própria brochura, e volta igual ao RAG. */
export const labelledValueSchema = z.object({ label: z.string().min(1), value: z.string().min(1) });
export type LabelledValue = z.infer<typeof labelledValueSchema>;

/** Dados de um tratamento. `ideal.title` é a linha sem os dois pontos finais; `facts` vêm na linha com " | " entre eles. */
export const treatmentDataSchema = z.object({
  ideal: z.object({ title: z.string().min(1), items: z.array(z.string().min(1)).min(1) }).optional(),
  howItWorks: labelledValueSchema.optional(),
  facts: z.array(labelledValueSchema).min(1),
  result: labelledValueSchema.optional(),
  recovery: labelledValueSchema.optional(),
});
export type TreatmentData = z.infer<typeof treatmentDataSchema>;

/** Seção sem estrutura: as linhas como estão na brochura. */
export const infoDataSchema = z.object({ lines: z.array(z.string().min(1)) });
export type InfoData = z.infer<typeof infoDataSchema>;

export type KnowledgeData = TreatmentData | InfoData;
export type KnowledgeKind = "treatment" | "info";

const keySchema = z.string().min(1);
const positionSchema = z.number().int().nonnegative();

/** Uma linha da tabela knowledge_sections, validada na borda (leitura e escrita). */
export const knowledgeRowSchema = z.discriminatedUnion("kind", [
  z.object({
    key: keySchema,
    kind: z.literal("treatment"),
    title: z.string().min(1),
    tagline: z.string().min(1).nullable(),
    data: treatmentDataSchema,
    position: positionSchema,
  }),
  z.object({
    key: keySchema,
    kind: z.literal("info"),
    title: z.string().min(1),
    tagline: z.null(),
    data: infoDataSchema,
    position: positionSchema,
  }),
]);
export type KnowledgeRow = z.infer<typeof knowledgeRowSchema>;

/** Seção como o RAG a lê: título e linhas (ver docs/integrations.md). */
export interface KnowledgeSection {
  title: string;
  body: string[];
}
