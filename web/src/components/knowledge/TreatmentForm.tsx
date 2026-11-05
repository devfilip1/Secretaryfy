import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import type { TreatmentRow } from "../../api";
import { emptyFact, treatmentDefaults, treatmentFormSchema, toTreatmentInput, type TreatmentFormValues } from "./form-values";
import { FactFields, LabelledValueFields } from "./LabelledValueFields";
import { ItemsField } from "./ItemsField";
import { FormSection, TextField, type SectionFormProps } from "./FormParts";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";

/** Formulário de um tratamento: nome, "Ideal para", como funciona, fatos, resultado e recuperação. */
export function TreatmentForm({ section, formId, onSubmit }: SectionFormProps<TreatmentRow>) {
  const form = useForm<TreatmentFormValues>({
    resolver: zodResolver(treatmentFormSchema),
    defaultValues: treatmentDefaults(section),
  });
  const facts = useFieldArray({ control: form.control, name: "facts" });
  const factsError = form.formState.errors.facts;
  const factsMessage = factsError?.root?.message ?? factsError?.message;

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
            <TextField name="tagline" label="Tagline" description="Optional. A short line shown after the title." />
          </FormSection>

          <FormSection title="Ideal for">
            <TextField name="ideal.title" label="Heading" description="The question the list answers, for example: Ideal para quem quer" />
            <ItemsField />
          </FormSection>

          <FormSection title="How it works">
            <LabelledValueFields name="howItWorks" />
          </FormSection>

          <FormSection title="Facts">
            {facts.fields.map((field, index) => (
              <FactFields
                key={field.id}
                index={index}
                onRemove={facts.fields.length > 1 ? () => facts.remove(index) : undefined}
              />
            ))}
            <FieldError errors={[{ message: factsMessage }]} />
            <div>
              <Button type="button" variant="secondary" onClick={() => facts.append(emptyFact())}>
                <Plus />
                Add fact
              </Button>
            </div>
          </FormSection>

          <FormSection title="Result">
            <LabelledValueFields name="result" />
          </FormSection>

          <FormSection title="Recovery">
            <LabelledValueFields name="recovery" />
          </FormSection>
        </FieldGroup>
      </form>
    </FormProvider>
  );
}
