import { z } from "zod";

/** Um rótulo e o seu valor, como "Preço: R$ 40 a R$ 85". O rótulo é o texto da própria brochura, e volta igual ao RAG. */
export const labelledValueSchema = z.object({ label: z.string().min(1), value: z.string().min(1) });
export type LabelledValue = z.infer<typeof labelledValueSchema>;

/** Um fato da linha de dados ("Preço: R$ 40 a R$ 85"). `assessment`: o valor é uma faixa e o valor final sai na avaliação; o aviso é escrito pelo render, na língua da clínica. */
export const factSchema = labelledValueSchema.extend({ assessment: z.boolean().optional() });
export type Fact = z.infer<typeof factSchema>;

/** Dados de um tratamento. `ideal.title` é a linha sem os dois pontos finais; `facts` vêm na linha com " | " entre eles. */
export const treatmentDataSchema = z.object({
  /** `false`: só informação, o cliente não marca por aqui (ADR 0014). Ausente = pode marcar. */
  bookable: z.boolean().optional(),
  /** Outros nomes com que o paciente pede este tratamento ("branqueamento"); o RAG os lê como sinônimos da busca. */
  otherNames: z.array(z.string().min(1)).optional(),
  ideal: z.object({ title: z.string().min(1), items: z.array(z.string().min(1)).min(1) }).optional(),
  howItWorks: labelledValueSchema.optional(),
  facts: z.array(factSchema).min(1),
  result: labelledValueSchema.optional(),
  recovery: labelledValueSchema.optional(),
});
export type TreatmentData = z.infer<typeof treatmentDataSchema>;

/** Seção sem estrutura: as linhas como estão na brochura. */
export const infoDataSchema = z.object({ lines: z.array(z.string().min(1)) });
export type InfoData = z.infer<typeof infoDataSchema>;

/**
 * Seção da clínica: endereço, contato e textos. O horário não está aqui: sai das regras de atendimento (BR-KNO-02).
 * `intro` vem antes do endereço e `closing` depois do contato.
 */
export const clinicDataSchema = z.object({
  intro: z.array(z.string().min(1)),
  address: z.array(z.string().min(1)).min(1),
  phone: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  closing: z.array(z.string().min(1)),
});
export type ClinicData = z.infer<typeof clinicDataSchema>;

export type KnowledgeData = TreatmentData | InfoData | ClinicData;
/** Tipos de seção; o painel e as rotas aceitam estes */
export const KNOWLEDGE_KINDS = ["treatment", "info", "clinic"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

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
  z.object({
    key: keySchema,
    kind: z.literal("clinic"),
    title: z.string().min(1),
    tagline: z.null(),
    data: clinicDataSchema,
    position: positionSchema,
  }),
]);
export type KnowledgeRow = z.infer<typeof knowledgeRowSchema>;

/** Um tratamento que o cliente pode marcar pelo WhatsApp (ADR 0014): tratamento sem `bookable: false`. */
export const isBookable = (row: KnowledgeRow): boolean => row.kind === "treatment" && row.data.bookable !== false;

/** Seção como o RAG a lê: título e linhas (ver docs/integrations.md). */
export interface KnowledgeSection {
  title: string;
  body: string[];
}
