import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { InfoRow } from "../../api";
import { infoDefaults, infoFormSchema, toInfoInput, type InfoFormValues } from "./form-values";
import { FormActions, TextField, type SectionFormProps } from "./FormParts";

/** Formulário de uma seção de texto: título e as linhas como estão na brochura. */
export function InfoForm({ section, saving, onCancel, onSubmit }: SectionFormProps<InfoRow>) {
  const form = useForm<InfoFormValues>({
    resolver: zodResolver(infoFormSchema),
    defaultValues: infoDefaults(section),
  });

  return (
    <FormProvider {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit((values) => onSubmit(toInfoInput(values)))}>
        <TextField name="title" label="Title" />
        <TextField name="lines" label="Lines, one per line" multiline />
        <FormActions saving={saving} onCancel={onCancel} />
      </form>
    </FormProvider>
  );
}
