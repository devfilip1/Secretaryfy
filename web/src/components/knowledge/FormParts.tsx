import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFormContext } from "react-hook-form";
import type { KnowledgeRow, SectionInput } from "../../api";
import { FILL_DURATION_OR_PRICE, REQUIRED } from "./form-values";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Formulário de uma seção: `formId` liga o botão Salvar do rodapé do diálogo ao <form>. */
export interface SectionFormProps<Row extends KnowledgeRow> {
  section?: Row;
  formId: string;
  onSubmit: (input: SectionInput) => void;
}

/** Mensagem de validação no idioma do painel: o código do form-values vira o texto; a do servidor segue como veio. */
export function useIssueText(): (message: string | undefined) => string | undefined {
  const { t } = useTranslation("knowledge");
  return (message) => {
    if (message === REQUIRED) return t("validation.required");
    if (message === FILL_DURATION_OR_PRICE) return t("validation.fillDurationOrPrice");
    return message;
  };
}

/** Grupo com título. Os campos dentro ficam perto; o espaço entre grupos (FieldGroup) é maior. */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <FieldSet className="min-w-0 gap-4">
      <FieldLegend className="text-lg font-bold">{title}</FieldLegend>
      {children}
    </FieldSet>
  );
}

/** Campo de texto ligado ao formulário pelo nome (react-hook-form, via FormProvider). */
export function TextField({
  name,
  label,
  description,
  placeholder,
  multiline = false,
}: {
  name: string;
  label: string;
  description: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const { register, getFieldState, formState } = useFormContext();
  const issueText = useIssueText();
  const { error } = getFieldState(name, formState);
  const Control = multiline ? Textarea : Input;
  return (
    <Field data-invalid={error ? true : undefined} className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Control
        id={id}
        {...register(name)}
        placeholder={placeholder}
        maxLength={multiline ? undefined : 200}
        aria-invalid={error ? true : undefined}
        aria-describedby={descriptionId}
      />
      <FieldDescription id={descriptionId}>{description}</FieldDescription>
      <FieldError errors={error ? [{ message: issueText(error.message) }] : []} />
    </Field>
  );
}
