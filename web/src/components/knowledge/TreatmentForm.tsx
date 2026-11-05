import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import { Plus } from "lucide-react";
import type { TreatmentRow } from "../../api";
import { treatmentDefaults, treatmentFormSchema, toTreatmentInput, type TreatmentFormValues } from "./form-values";
import { FieldMessage, FormActions, FormGroup, TextField, type SectionFormProps } from "./FormParts";
import { LabelledValueFields } from "./LabelledValueFields";
import { Button } from "@/components/ui/button";

const EMPTY_FACT = { label: "", value: "" };

/** Formulário de um tratamento: título, "Ideal para", fatos e as partes opcionais. */
export function TreatmentForm({ section, saving, onCancel, onSubmit }: SectionFormProps<TreatmentRow>) {
  const form = useForm<TreatmentFormValues>({
    resolver: zodResolver(treatmentFormSchema),
    defaultValues: treatmentDefaults(section),
  });
  const facts = useFieldArray({ control: form.control, name: "facts" });
  const factsError = form.formState.errors.facts?.message;

  return (
    <FormProvider {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit((values) => onSubmit(toTreatmentInput(values)))}>
        <TextField name="title" label="Title" />
        <TextField name="tagline" label="Tagline" />
        <FormGroup title="Ideal for">
          <TextField name="ideal.title" label="Heading" placeholder="Ideal para quem quer" />
          <TextField name="ideal.items" label="Items, one per line" multiline />
        </FormGroup>
        <LabelledValueFields name="howItWorks" title="How it works" />
        <FormGroup title="Facts">
          {facts.fields.map((field, index) => (
            <LabelledValueFields
              key={field.id}
              name={`facts.${index}`}
              onRemove={facts.fields.length > 1 ? () => facts.remove(index) : undefined}
            />
          ))}
          <FieldMessage message={factsError} />
          <div>
            <Button type="button" variant="secondary" onClick={() => facts.append(EMPTY_FACT)}>
              <Plus />
              Add fact
            </Button>
          </div>
        </FormGroup>
        <LabelledValueFields name="result" title="Result" />
        <LabelledValueFields name="recovery" title="Recovery" />
        <FormActions saving={saving} onCancel={onCancel} />
      </form>
    </FormProvider>
  );
}
