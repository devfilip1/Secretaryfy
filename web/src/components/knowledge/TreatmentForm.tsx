import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import type { KnowledgeLabels, TreatmentRow } from "../../api";
import { treatmentDefaults, treatmentFormSchema, toTreatmentInput, type TreatmentFormValues } from "./form-values";
import { ExtraFactFields, FactValueField, LABEL_DESCRIPTION, ValueField } from "./LabelledValueFields";
import { ItemsField } from "./ItemsField";
import { FormSection, TextField, type SectionFormProps } from "./FormParts";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";

const NEW_EXTRA = { label: "", value: "", assessment: false };

/** Formulário de um tratamento. Os nomes são os da conversa; os rótulos da brochura ficam em "Change wording". */
export function TreatmentForm({
  section,
  formId,
  onSubmit,
  labels,
}: SectionFormProps<TreatmentRow> & { labels: KnowledgeLabels }) {
  const form = useForm<TreatmentFormValues>({
    resolver: zodResolver(treatmentFormSchema),
    defaultValues: treatmentDefaults(labels, section),
  });
  const extras = useFieldArray({ control: form.control, name: "extras" });

  return (
    <FormProvider {...form}>
      <form id={formId} onSubmit={form.handleSubmit((values) => onSubmit(toTreatmentInput(values)))}>
        <FieldGroup className="gap-10">
          <FormSection title="Basics">
            <TextField
              name="title"
              label="Title"
              description="The name patients use, for example: Limpeza Dental. One treatment per section."
            />
            <TextField
              name="tagline"
              label="Short description"
              description="Optional. A short line shown after the title, for example: O Primeiro Passo para um Sorriso Saudável."
            />
          </FormSection>

          <FormSection title="Who it is for">
            <ItemsField />
          </FormSection>

          <FormSection title="How it works">
            <ValueField
              name="howItWorks"
              label="Text"
              multiline
              description="How it is done and which materials it uses, for example: Remoção de placa e tártaro com ultrassom, seguida de polimento."
            />
          </FormSection>

          <FormSection title="Duration">
            <FactValueField name="duration" label="Value" description="For example: 30 a 50 minutos" />
          </FormSection>

          <FormSection title="Price">
            <FactValueField name="price" label="Value" description="For example: R$ 40 a R$ 85" withAssessment assessmentNote={labels.assessment} />
          </FormSection>

          <FormSection title="More details">
            {extras.fields.map((field, index) => (
              <ExtraFactFields key={field.id} index={index} onRemove={() => extras.remove(index)} assessmentNote={labels.assessment} />
            ))}
            <div>
              <Button type="button" variant="secondary" onClick={() => extras.append(NEW_EXTRA)}>
                <Plus />
                Add detail
              </Button>
            </div>
          </FormSection>

          <FormSection title="Result">
            <ValueField
              name="result"
              label="Text"
              multiline
              description="What the patient gets and how long it lasts, for example: Até 8 tons mais claros, com resultado que dura até 3 anos."
            />
          </FormSection>

          <FormSection title="Recovery time">
            <ValueField name="recovery" label="Time" description="How long healing takes afterwards, for example: 3 a 7 dias. Optional." />
          </FormSection>

          <details className="rounded-lg border border-border p-4">
            <summary className="cursor-pointer text-sm font-semibold">Change wording</summary>
            <div className="mt-4 grid gap-4">
              <TextField name="ideal.title" label="Heading for Who it is for" description={LABEL_DESCRIPTION} />
              <TextField name="howItWorks.label" label="Label for How it works" description={LABEL_DESCRIPTION} />
              <TextField name="duration.label" label="Label for Duration" description={LABEL_DESCRIPTION} />
              <TextField name="price.label" label="Label for Price" description={LABEL_DESCRIPTION} />
              <TextField name="result.label" label="Label for Result" description={LABEL_DESCRIPTION} />
              <TextField name="recovery.label" label="Label for Recovery time" description={LABEL_DESCRIPTION} />
            </div>
          </details>
        </FieldGroup>
      </form>
    </FormProvider>
  );
}
