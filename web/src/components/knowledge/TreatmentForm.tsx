import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import type { KnowledgeLabels, TreatmentRow } from "../../api";
import { treatmentDefaults, treatmentFormSchema, toTreatmentInput, type TreatmentFormValues } from "./form-values";
import { ExtraFactFields, FactValueField, SwitchField, ValueField } from "./LabelledValueFields";
import { ItemsField } from "./ItemsField";
import { FormSection, TextField, type SectionFormProps } from "./FormParts";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";

const NEW_EXTRA = { label: "", value: "", assessment: false };

/** Formulário de um tratamento. Os rótulos da brochura ("Preço", "Duração"…) são os do idioma e não se editam: ficam nos dados. */
export function TreatmentForm({
  section,
  formId,
  onSubmit,
  labels,
}: SectionFormProps<TreatmentRow> & { labels: KnowledgeLabels }) {
  const { t } = useTranslation("knowledge");
  const form = useForm<TreatmentFormValues>({
    resolver: zodResolver(treatmentFormSchema),
    defaultValues: treatmentDefaults(labels, section),
  });
  const extras = useFieldArray({ control: form.control, name: "extras" });

  return (
    <FormProvider {...form}>
      <form id={formId} onSubmit={form.handleSubmit((values) => onSubmit(toTreatmentInput(values)))}>
        <FieldGroup className="gap-10">
          <FormSection title={t("section.basics")}>
            <TextField name="title" label={t("treatmentForm.title.label")} description={t("treatmentForm.title.description")} />
            <TextField name="tagline" label={t("treatmentForm.tagline.label")} description={t("treatmentForm.tagline.description")} />
          </FormSection>

          <FormSection title={t("section.booking")}>
            <SwitchField
              name="bookable"
              label={t("treatmentForm.bookable.label")}
              description={t("treatmentForm.bookable.description")}
            />
            <TextField
              name="appointmentMinutes"
              label={t("treatmentForm.appointmentMinutes.label")}
              description={t("treatmentForm.appointmentMinutes.description")}
            />
          </FormSection>

          <FormSection title={t("section.otherNames")}>
            <ItemsField
              name="otherNames"
              label={t("treatmentForm.otherNames.label")}
              description={t("treatmentForm.otherNames.description")}
            />
          </FormSection>

          <FormSection title={t("section.idealFor")}>
            <ItemsField
              name="ideal.items"
              label={t("treatmentForm.idealItems.label")}
              description={t("treatmentForm.idealItems.description")}
            />
          </FormSection>

          <FormSection title={t("section.howItWorks")}>
            <ValueField
              name="howItWorks"
              label={t("treatmentForm.howItWorks.label")}
              multiline
              description={t("treatmentForm.howItWorks.description")}
            />
          </FormSection>

          <FormSection title={t("section.duration")}>
            <FactValueField name="duration" label={t("treatmentForm.duration.label")} description={t("treatmentForm.duration.description")} />
          </FormSection>

          <FormSection title={t("section.price")}>
            <FactValueField
              name="price"
              label={t("treatmentForm.price.label")}
              description={t("treatmentForm.price.description")}
              withAssessment
              assessmentNote={labels.assessment}
            />
          </FormSection>

          <FormSection title={t("section.moreDetails")}>
            {extras.fields.map((field, index) => (
              <ExtraFactFields key={field.id} index={index} onRemove={() => extras.remove(index)} assessmentNote={labels.assessment} />
            ))}
            <div>
              <Button type="button" variant="secondary" onClick={() => extras.append(NEW_EXTRA)}>
                <Plus />
                {t("extra.add")}
              </Button>
            </div>
          </FormSection>

          <FormSection title={t("section.result")}>
            <ValueField
              name="result"
              label={t("treatmentForm.result.label")}
              multiline
              description={t("treatmentForm.result.description")}
            />
          </FormSection>

          <FormSection title={t("section.recoveryTime")}>
            <ValueField name="recovery" label={t("treatmentForm.recovery.label")} description={t("treatmentForm.recovery.description")} />
          </FormSection>
        </FieldGroup>
      </form>
    </FormProvider>
  );
}
