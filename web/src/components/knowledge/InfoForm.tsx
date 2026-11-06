import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { InfoRow } from "../../api";
import { infoDefaults, infoFormSchema, toInfoInput, type InfoFormValues } from "./form-values";
import { FormSection, TextField, type SectionFormProps } from "./FormParts";
import { FieldGroup } from "@/components/ui/field";

/** Formulário de uma seção de texto livre: título e as linhas como estão na brochura. */
export function InfoForm({ section, formId, onSubmit }: SectionFormProps<InfoRow>) {
  const form = useForm<InfoFormValues>({
    resolver: zodResolver(infoFormSchema),
    defaultValues: infoDefaults(section),
  });

  return (
    <FormProvider {...form}>
      <form id={formId} onSubmit={form.handleSubmit((values) => onSubmit(toInfoInput(values)))}>
        <FieldGroup className="gap-10">
          <FormSection title="Basics">
            <TextField name="title" label="Title" description="The subject of the lines, for example: Endereço" />
          </FormSection>
          <FormSection title="Content">
            <TextField
              name="lines"
              label="Text"
              multiline
              description="One line per row, written as patients should read it. Press Enter for a new line."
            />
          </FormSection>
        </FieldGroup>
      </form>
    </FormProvider>
  );
}
