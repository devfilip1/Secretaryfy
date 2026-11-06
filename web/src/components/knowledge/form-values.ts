import { z } from "zod";
import { clinicDataSchema, infoDataSchema, treatmentDataSchema, type Fact, type LabelledValue } from "@server/modules/knowledge/types";
import type { ClinicRow, InfoRow, KnowledgeLabels, SectionInput, TreatmentRow } from "../../api";

// Valores dos formulários: texto como o operador digita. Aqui ficam o schema do formulário,
// a conversão para a forma do servidor e o caminho de volta (seção existente -> valores).
// Este arquivo é puro (sem React): os testes ficam em form-values.test.ts.
//
// Um tratamento tem campos fixos: Duração, Preço, Como funciona, Resultado e Recuperação. Os rótulos da
// brochura (labels) são o texto já preenchido; o servidor guarda cada um como {label, value}. Fatos que não
// são Duração nem Preço ficam em "Mais detalhes", com o nome digitado. Na volta, a ordem dos fatos vira
// Duração, Preço e depois os outros, na ordem em que aparecem.

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
  duration: FactFormValue;
  price: FactFormValue;
  extras: FactFormValue[];
  result: LabelledFormValue;
  recovery: LabelledFormValue;
}

/** Dados da clínica como o formulário os guarda: texto por linha. Os horários não entram aqui (vêm da Agenda). */
export interface ClinicFormValues {
  title: string;
  intro: string;
  address: ItemFormValue[];
  phone: string;
  email: string;
  closing: string;
}

export type ClinicData = z.infer<typeof clinicDataSchema>;

export interface InfoFormValues {
  title: string;
  lines: string;
}

type FormIssue = { path: (string | number)[]; message: string };

const requiredText = z.string().trim().min(1, "Required");
const blockSchema = z.object({ label: z.string(), value: z.string() });
const factSchema = blockSchema.extend({ assessment: z.boolean() });

/** Um campo com valor; o rótulo sozinho não conta como preenchido. */
const hasValue = (block: LabelledFormValue) => block.value.trim() !== "";

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

/**
 * Duração e Preço são opcionais: a linha sem valor fica de fora do salvamento.
 * Sem nenhum valor em nenhum fato, o formulário não salva. Um fato com valor precisa de nome.
 */
export function factIssues(values: TreatmentFormValues): FormIssue[] {
  const anyValue = [values.duration, values.price, ...values.extras].some(hasValue);
  if (!anyValue) return [{ path: ["duration", "value"], message: "Fill in Duration or Price" }];

  const issues: FormIssue[] = [];
  for (const name of ["duration", "price"] as const) {
    if (hasValue(values[name]) && values[name].label.trim() === "") issues.push({ path: [name, "label"], message: "Required" });
  }
  values.extras.forEach((fact, index) => {
    if (hasValue(fact) && fact.label.trim() === "") issues.push({ path: ["extras", index, "label"], message: "Required" });
  });
  return issues;
}

export const treatmentFormSchema = z
  .object({
    title: requiredText,
    tagline: z.string(),
    ideal: z.object({ title: z.string(), items: z.array(z.object({ text: z.string() })) }),
    howItWorks: blockSchema,
    duration: factSchema,
    price: factSchema,
    extras: z.array(factSchema),
    result: blockSchema,
    recovery: blockSchema,
  })
  .superRefine((values, ctx) => {
    const issues = factIssues(values);
    if (issues.length > 0) {
      for (const issue of issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path.map(String) });
      return;
    }
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

/** Bloco opcional: sem valor é como não preenchido (undefined); com valor, o rótulo vai junto, mesmo vazio. */
function optionalLabelled(block: LabelledFormValue): LabelledValue | undefined {
  const value = block.value.trim();
  return value ? { label: block.label.trim(), value } : undefined;
}

/** O campo "assessment" só existe quando está ligado: a seção sem faixa de preço fica igual à de antes. */
function toFact(fact: FactFormValue): Fact {
  const label = fact.label.trim();
  const value = fact.value.trim();
  return fact.assessment ? { label, value, assessment: true } : { label, value };
}

function toBlock(block: LabelledValue | undefined, fallbackLabel: string): LabelledFormValue {
  return { label: block?.label ?? fallbackLabel, value: block?.value ?? "" };
}

function toFactValue(fact: Fact): FactFormValue {
  return { label: fact.label, value: fact.value, assessment: fact.assessment ?? false };
}

function newFact(label: string): FactFormValue {
  return { label, value: "", assessment: false };
}

export function toTreatmentInput(values: TreatmentFormValues): SectionInput {
  const idealTitle = values.ideal.title.trim();
  const items = values.ideal.items.map((item) => item.text.trim()).filter((text) => text !== "");
  return {
    title: values.title.trim(),
    tagline: values.tagline.trim() || null,
    data: {
      // A lista de "Ideal para" é obrigatória no servidor: sem linhas, o bloco fica de fora
      ideal: items.length > 0 ? { title: idealTitle, items } : undefined,
      howItWorks: optionalLabelled(values.howItWorks),
      facts: [values.duration, values.price, ...values.extras].filter(hasValue).map(toFact),
      result: optionalLabelled(values.result),
      recovery: optionalLabelled(values.recovery),
    },
  };
}

/** Seção existente -> valores: Duração e Preço são reconhecidos pelo rótulo da brochura; o resto vai para "Mais detalhes". */
export function treatmentDefaults(labels: KnowledgeLabels, section?: TreatmentRow): TreatmentFormValues {
  const data = section?.data;
  const facts = data?.facts ?? [];
  const duration = facts.find((fact) => fact.label === labels.duration);
  const price = facts.find((fact) => fact !== duration && fact.label === labels.price);
  return {
    title: section?.title ?? "",
    tagline: section?.tagline ?? "",
    ideal: {
      title: data?.ideal?.title ?? labels.ideal,
      items: (data?.ideal?.items ?? []).map((text) => ({ text })),
    },
    howItWorks: toBlock(data?.howItWorks, labels.howItWorks),
    duration: duration ? toFactValue(duration) : newFact(labels.duration),
    price: price ? toFactValue(price) : newFact(labels.price),
    extras: facts.filter((fact) => fact !== duration && fact !== price).map(toFactValue),
    result: toBlock(data?.result, labels.result),
    recovery: toBlock(data?.recovery, labels.recovery),
  };
}

export const clinicFormSchema = z
  .object({
    title: requiredText,
    intro: z.string(),
    address: z.array(z.object({ text: z.string() })),
    phone: z.string(),
    email: z.string(),
    closing: z.string(),
  })
  .superRefine((values, ctx) => {
    const checked = clinicDataSchema.safeParse(toClinicData(values));
    if (!checked.success) reportServerIssues(checked.error, ctx);
  });

/** Texto opcional: vazio vira undefined, e o campo não vai para o dado salvo. */
function optionalText(text: string): string | undefined {
  return text.trim() || undefined;
}

export function toClinicData(values: ClinicFormValues): ClinicData {
  return {
    intro: splitLines(values.intro),
    address: values.address.map((item) => item.text.trim()).filter((text) => text !== ""),
    phone: optionalText(values.phone),
    email: optionalText(values.email),
    closing: splitLines(values.closing),
  };
}

export function toClinicInput(values: ClinicFormValues): SectionInput {
  return { title: values.title.trim(), tagline: null, data: toClinicData(values) };
}

/** Seção da clínica -> valores. Sem endereço, o formulário abre com uma linha vazia para preencher. */
export function clinicDefaults(section?: ClinicRow): ClinicFormValues {
  const data = section?.data;
  const address = (data?.address ?? []).map((text) => ({ text }));
  return {
    title: section?.title ?? "",
    intro: data?.intro.join("\n") ?? "",
    address: address.length > 0 ? address : [{ text: "" }],
    phone: data?.phone ?? "",
    email: data?.email ?? "",
    closing: data?.closing.join("\n") ?? "",
  };
}

export function toInfoInput(values: InfoFormValues): SectionInput {
  return { title: values.title.trim(), tagline: null, data: { lines: splitLines(values.lines) } };
}

export function infoDefaults(section?: InfoRow): InfoFormValues {
  return { title: section?.title ?? "", lines: section?.data.lines.join("\n") ?? "" };
}
