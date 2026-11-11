import { Trash2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { TextField } from "./FormParts";
import { readLine, type ReadBlock } from "./read-preview";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Muted } from "../Muted";

/** Texto dos campos de rótulo ("Alterar redação"): o rótulo já vem preenchido com a palavra da brochura. */

/** Linha de leitura: como o assistente vai ler o campo, aparece só quando há valor. `assessmentNote` é a nota da brochura. */
export function ReadPreview({ name, assessmentNote = "" }: { name: string; assessmentNote?: string }) {
  const { t } = useTranslation("knowledge");
  const { control } = useFormContext();
  const block = useWatch({ control, name }) as ReadBlock | undefined;
  const line = readLine(block ?? { label: "", value: "" }, assessmentNote);
  if (!line) return null;
  return <Muted as="p">{t("read.preview", { line })}</Muted>;
}

/** Um campo de texto (Como funciona, Resultado, Recuperação): o valor e a linha de leitura embaixo. */
export function ValueField({
  name,
  label,
  description,
  multiline = false,
}: {
  name: string;
  label: string;
  description: string;
  multiline?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <TextField name={`${name}.value`} label={label} description={description} multiline={multiline} />
      <ReadPreview name={name} />
    </div>
  );
}

/** Um fato de valor fixo (Duração, Preço): o valor e, se `withAssessment`, a chave de faixa de preço. */
export function FactValueField({
  name,
  label,
  description,
  withAssessment = false,
  assessmentNote = "",
}: {
  name: string;
  label: string;
  description: string;
  withAssessment?: boolean;
  assessmentNote?: string;
}) {
  return (
    <div className="grid gap-2">
      <TextField name={`${name}.value`} label={label} description={description} />
      {withAssessment && <AssessmentSwitch name={`${name}.assessment`} />}
      <ReadPreview name={name} assessmentNote={assessmentNote} />
    </div>
  );
}

/** Um detalhe em "Mais detalhes": nome e valor digitados, com a chave de faixa e o botão de remover. */
export function ExtraFactFields({
  index,
  onRemove,
  assessmentNote,
}: {
  index: number;
  onRemove: () => void;
  assessmentNote: string;
}) {
  const { t } = useTranslation("knowledge");
  const name = `extras.${index}`;
  return (
    <div className="grid gap-4 border-b border-border pb-6 last:border-b-0 last:pb-0">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name={`${name}.label`} label={t("extra.name")} description={t("extra.nameExample")} />
        <TextField name={`${name}.value`} label={t("extra.value")} description={t("extra.valueExample")} />
      </div>
      <ReadPreview name={name} assessmentNote={assessmentNote} />
      <div className="flex items-center gap-3">
        <AssessmentSwitch name={`${name}.assessment`} />
        <Button
          type="button"
          variant="destructive-ghost"
          size="icon-sm"
          aria-label={t("extra.remove", { number: index + 1 })}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

/** Chave ligada/desligada com texto e descrição; ligada grava `true` no campo. */
export function SwitchField({ name, label, description }: { name: string; label: string; description: string }) {
  const id = useId();
  const { control } = useFormContext();
  return (
    <Field orientation="horizontal" className="min-w-0 flex-1">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Switch id={id} checked={field.value === true} onCheckedChange={field.onChange} name={field.name} />
        )}
      />
    </Field>
  );
}

/** A chave "Final value depends on the assessment" (ligada grava `assessment: true`). */
function AssessmentSwitch({ name }: { name: string }) {
  const { t } = useTranslation("knowledge");
  return <SwitchField name={name} label={t("assessment.label")} description={t("assessment.description")} />;
}
