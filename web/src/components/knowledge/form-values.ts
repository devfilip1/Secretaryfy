import { z } from "zod";
import { infoDataSchema, treatmentDataSchema, type LabelledValue } from "@server/modules/knowledge/types";
import type { InfoRow, SectionInput, TreatmentRow } from "../../api";

// Valores dos formulários: texto como o operador digita. Aqui ficam o schema do formulário,
// a conversão para a forma do servidor e o caminho de volta (seção existente -> valores).

export interface LabelledFormValue {
  label: string;
  value: string;
}

export interface TreatmentFormValues {
  title: string;
  tagline: string;
  ideal: { title: string; items: string };
  howItWorks: LabelledFormValue;
  facts: LabelledFormValue[];
  result: LabelledFormValue;
  recovery: LabelledFormValue;
}

export interface InfoFormValues {
  title: string;
  lines: string;
}

const requiredText = z.string().trim().min(1, "Required");
const optionalBlock = z.object({ label: z.string(), value: z.string() });
const requiredBlock = z.object({ label: requiredText, value: requiredText });

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
    ideal: z.object({ title: z.string(), items: z.string() }),
    howItWorks: optionalBlock,
    facts: z.array(requiredBlock).min(1, "Add at least one fact"),
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

function splitLines(text: string): string[] {
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

function toBlock(block?: LabelledValue): LabelledFormValue {
  return { label: block?.label ?? "", value: block?.value ?? "" };
}

export function toTreatmentInput(values: TreatmentFormValues): SectionInput {
  const items = splitLines(values.ideal.items);
  const hasIdeal = values.ideal.title.trim() !== "" || items.length > 0;
  return {
    title: values.title.trim(),
    tagline: values.tagline.trim() || null,
    data: {
      ideal: hasIdeal ? { title: values.ideal.title.trim(), items } : undefined,
      howItWorks: optionalLabelled(values.howItWorks),
      facts: values.facts.map((fact) => ({ label: fact.label.trim(), value: fact.value.trim() })),
      result: optionalLabelled(values.result),
      recovery: optionalLabelled(values.recovery),
    },
  };
}

export function treatmentDefaults(section?: TreatmentRow): TreatmentFormValues {
  const data = section?.data;
  const facts = data?.facts.map((fact) => toBlock(fact)) ?? [];
  return {
    title: section?.title ?? "",
    tagline: section?.tagline ?? "",
    ideal: { title: data?.ideal?.title ?? "", items: data?.ideal?.items.join("\n") ?? "" },
    howItWorks: toBlock(data?.howItWorks),
    facts: facts.length > 0 ? facts : [toBlock()],
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
