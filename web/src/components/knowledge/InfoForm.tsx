import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { FormProvider, useForm } from "react-hook-form";
import type { InfoRow } from "../../api";
import { infoDefaults, infoFormSchema, toInfoInput, type InfoFormValues } from "./form-values";
import { FormSection, TextField, type SectionFormProps } from "./FormParts";
import { FieldGroup } from "@/components/ui/field";

/** Formulário de uma seção de texto livre: título e as linhas como estão na brochura. */
export function InfoForm({ section, formId, onSubmit }: SectionFormProps<InfoRow>) {
  const { t } = useTranslation("knowledge");
  const form = useForm<InfoFormValues>({
    resolver: zodResolver(infoFormSchema),
    defaultValues: infoDefaults(section),
  });

  return (
    <FormProvider {...form}>
      <form id={formId} onSubmit={form.handleSubmit((values) => onSubmit(toInfoInput(values)))}>
        <FieldGroup className="gap-10">
          <FormSection title={t("section.basics")}>
            <TextField name="title" label={t("infoForm.title.label")} description={t("infoForm.title.description")} />
          </FormSection>
          <FormSection title={t("section.content")}>
            <TextField
              name="lines"
              label={t("infoForm.lines.label")}
              multiline
              description={t("infoForm.lines.description")}
            />
          </FormSection>
        </FieldGroup>
      </form>
    </FormProvider>
  );
}
