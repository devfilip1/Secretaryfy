import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import type { ClinicRow, KnowledgeLabels } from "../../api";
import { clinicDefaults, clinicFormSchema, toClinicData, toClinicInput, type ClinicFormValues } from "./form-values";
import { clinicReadLines } from "./read-preview";
import { ItemsField } from "./ItemsField";
import { FormSection, TextField, type SectionFormProps } from "./FormParts";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Muted } from "../Muted";

/** Formulário da clínica: uma seção só, criada pela importação. Os horários vêm da Agenda e são só lidos aqui. */
export function ClinicForm({
  section,
  formId,
  onSubmit,
  labels,
  hours,
}: SectionFormProps<ClinicRow> & { labels: KnowledgeLabels; hours: string[] }) {
  const { t } = useTranslation("knowledge");
  const form = useForm<ClinicFormValues>({
    resolver: zodResolver(clinicFormSchema),
    defaultValues: clinicDefaults(section),
  });
  const values = useWatch({ control: form.control }) as ClinicFormValues;
  const readLines = clinicReadLines(toClinicData(values), labels, hours);

  return (
    <FormProvider {...form}>
      <form id={formId} onSubmit={form.handleSubmit((input) => onSubmit(toClinicInput(input)))}>
        <FieldGroup className="gap-10">
          <FormSection title={t("section.basics")}>
            <TextField name="title" label={t("clinicForm.title.label")} description={t("clinicForm.title.description")} />
            <TextField name="intro" label={t("clinicForm.intro.label")} multiline description={t("clinicForm.intro.description")} />
          </FormSection>

          <FormSection title={t("section.address")}>
            <ItemsField name="address" label={t("clinicForm.address.label")} description={t("clinicForm.address.description")} />
          </FormSection>

          <FormSection title={t("section.contact")}>
            <TextField name="phone" label={t("clinicForm.phone.label")} description={t("clinicForm.phone.description")} />
            <TextField name="email" label={t("clinicForm.email.label")} description={t("clinicForm.email.description")} />
          </FormSection>

          <FormSection title={t("section.openingHours")}>
            <LinesBox lines={hours} empty={t("clinicForm.hours.empty")} />
            <Muted as="p">{t("clinicForm.hours.note")}</Muted>
            <div>
              <Button variant="link" className="px-0" asChild>
                <a href="#/calendar">{t("clinicForm.hours.change")}</a>
              </Button>
            </div>
          </FormSection>

          <FormSection title={t("section.closingText")}>
            <TextField name="closing" label={t("clinicForm.closing.label")} multiline description={t("clinicForm.closing.description")} />
          </FormSection>

          <FormSection title={t("section.assistantReads")}>
            <Muted as="p">{t("clinicForm.reads.intro")}</Muted>
            <LinesBox lines={readLines} empty={t("clinicForm.reads.empty")} />
          </FormSection>
        </FieldGroup>
      </form>
    </FormProvider>
  );
}

/** Linhas numa caixa com borda: os horários e a leitura do assistente. Sem linhas, mostra `empty`. */
function LinesBox({ lines, empty }: { lines: string[]; empty: string }) {
  if (lines.length === 0) return <Muted as="p">{empty}</Muted>;
  return (
    <div className="grid gap-1 rounded-lg border border-border p-4 text-sm break-words text-pretty">
      {lines.map((line, index) => (
        <p key={`${index}-${line}`}>{line}</p>
      ))}
    </div>
  );
}
