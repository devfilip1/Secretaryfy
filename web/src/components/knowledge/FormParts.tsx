import { useId, type ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import type { InfoRow, SectionInput, TreatmentRow } from "../../api";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Formulário de uma seção: `formId` liga o botão Salvar do rodapé do diálogo ao <form>. */
export interface SectionFormProps<Row extends TreatmentRow | InfoRow> {
  section?: Row;
  formId: string;
  onSubmit: (input: SectionInput) => void;
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
      <FieldError errors={[error]} />
    </Field>
  );
}
