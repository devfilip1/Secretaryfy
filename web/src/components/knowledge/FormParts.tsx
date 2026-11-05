import type { ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import type { InfoRow, SectionInput, TreatmentRow } from "../../api";
import { Field } from "../Field";
import { Muted } from "../Muted";
import { Title } from "../Title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface SectionFormProps<Row extends TreatmentRow | InfoRow> {
  section?: Row;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: SectionInput) => void;
}

/** Erro de um campo, em destaque. */
export function FieldMessage({ message }: { message?: string }) {
  return message ? <Muted as="p" tone="destructive">{message}</Muted> : null;
}

/** Grupo de campos com título opcional. */
export function FormGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      {title && <Title level={3}>{title}</Title>}
      {children}
    </div>
  );
}

/** Campo ligado ao formulário pelo nome (react-hook-form, via FormProvider). */
export function TextField({ name, label, placeholder, multiline = false }: { name: string; label: string; placeholder?: string; multiline?: boolean }) {
  const { register, getFieldState, formState } = useFormContext();
  const { error } = getFieldState(name, formState);
  const Control = multiline ? Textarea : Input;
  return (
    <div className="grid gap-1">
      <Field>
        {label}
        <Control {...register(name)} placeholder={placeholder} aria-invalid={error ? true : undefined} maxLength={multiline ? undefined : 200} />
      </Field>
      <FieldMessage message={error?.message} />
    </div>
  );
}

/** Cancelar e salvar: o botão de envio é o único submit do formulário. */
export function FormActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
