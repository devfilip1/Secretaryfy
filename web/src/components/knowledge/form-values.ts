import { z } from "zod";
import { infoDataSchema, treatmentDataSchema, type Fact, type LabelledValue } from "@server/modules/knowledge/types";
import type { InfoRow, SectionInput, TreatmentRow } from "../../api";

// Valores dos formulários: texto como o operador digita. Aqui ficam o schema do formulário,
// a conversão para a forma do servidor e o caminho de volta (seção existente -> valores).
// Este arquivo é puro (sem React): os testes ficam em form-values.test.ts.

export interface LabelledFormValue {
  label: string;
  value: string;
}

export interface FactFormValue extends LabelledFormValue {
  assessment: boolean;
}

/** Uma linha da lista "Ideal para": a lista é um array de linhas para o useFieldArray. */
export interface ItemFormValue {
  text: string;
}

export interface TreatmentFormValues {
  title: string;
  tagline: string;
  ideal: { title: string; items: ItemFormValue[] };
  howItWorks: LabelledFormValue;
  facts: FactFormValue[];
  result: LabelledFormValue;
  recovery: LabelledFormValue;
}

export interface InfoFormValues {
  title: string;
  lines: string;
}

const requiredText = z.string().trim().min(1, "Required");
const optionalBlock = z.object({ label: z.string(), value: z.string() });
const requiredFact = z.object({ label: requiredText, value: requiredText, assessment: z.boolean() });

/** Erros do schema do servidor viram erros do campo; "too_small" (vazio) vira "Required". */
function reportServerIssues(error: z.ZodError, ctx: z.RefinementCtx) {
  for (const issue of error.issues) {
    ctx.addIssue({
      code: "custom",
      message: issue.code === "too_small" ? "Required" : issue.message,
      path: issue.path.map(String),
    });
  }
}

export const treatmentFormSchema = z
  .object({
    title: requiredText,
    tagline: z.string(),
    ideal: z.object({ title: z.string(), items: z.array(z.object({ text: z.string() })) }),
    howItWorks: optionalBlock,
    facts: z.array(requiredFact).min(1, "Add at least one fact"),
    result: optionalBlock,
    recovery: optionalBlock,
  })
  .superRefine((values, ctx) => {
    const checked = treatmentDataSchema.safeParse(toTreatmentInput(values).data);
    if (!checked.success) reportServerIssues(checked.error, ctx);
  });

export const infoFormSchema = z
  .object({ title: requiredText, lines: z.string() })
  .superRefine((values, ctx) => {
    const checked = infoDataSchema.safeParse(toInfoInput(values).data);
    if (!checked.success) reportServerIssues(checked.error, ctx);
  });

/** Uma linha por linha do texto, sem linhas vazias. */
export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Bloco opcional: vazio nos dois campos vira undefined; preenchido em um só deixa o servidor apontar o que falta. */
function optionalLabelled(block: LabelledFormValue): LabelledValue | undefined {
  const label = block.label.trim();
  const value = block.value.trim();
  return label || value ? { label, value } : undefined;
}

/** O campo "assessment" só existe quando está ligado: a seção sem faixa de preço fica igual à de antes. */
function toFact(fact: FactFormValue): Fact {
  const label = fact.label.trim();
  const value = fact.value.trim();
  return fact.assessment ? { label, value, assessment: true } : { label, value };
}

function toBlock(block?: LabelledValue): LabelledFormValue {
  return { label: block?.label ?? "", value: block?.value ?? "" };
}

function toFactValue(fact: Fact): FactFormValue {
  return { label: fact.label, value: fact.value, assessment: fact.assessment ?? false };
}

export function toTreatmentInput(values: TreatmentFormValues): SectionInput {
  const idealTitle = values.ideal.title.trim();
  const items = values.ideal.items.map((item) => item.text.trim()).filter((text) => text !== "");
  const hasIdeal = idealTitle !== "" || items.length > 0;
  return {
    title: values.title.trim(),
    tagline: values.tagline.trim() || null,
    data: {
      ideal: hasIdeal ? { title: idealTitle, items } : undefined,
      howItWorks: optionalLabelled(values.howItWorks),
      facts: values.facts.map(toFact),
      result: optionalLabelled(values.result),
      recovery: optionalLabelled(values.recovery),
    },
  };
}

export function emptyFact(): FactFormValue {
  return { label: "", value: "", assessment: false };
}

export function treatmentDefaults(section?: TreatmentRow): TreatmentFormValues {
  const data = section?.data;
  return {
    title: section?.title ?? "",
    tagline: section?.tagline ?? "",
    ideal: {
      title: data?.ideal?.title ?? "",
      items: (data?.ideal?.items ?? []).map((text) => ({ text })),
    },
    howItWorks: toBlock(data?.howItWorks),
    facts: data && data.facts.length > 0 ? data.facts.map(toFactValue) : [emptyFact()],
    result: toBlock(data?.result),
    recovery: toBlock(data?.recovery),
  };
}

export function toInfoInput(values: InfoFormValues): SectionInput {
  return { title: values.title.trim(), tagline: null, data: { lines: splitLines(values.lines) } };
}

export function infoDefaults(section?: InfoRow): InfoFormValues {
  return { title: section?.title ?? "", lines: section?.data.lines.join("\n") ?? "" };
}
