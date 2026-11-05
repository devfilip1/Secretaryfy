import { Trash2 } from "lucide-react";
import { useId } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { TextField } from "./FormParts";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

/** Um rótulo e o seu valor (ex.: "Como funciona" e "Remoção de placa..."), no nome de campo `name`. */
export function LabelledValueFields({ name }: { name: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField name={`${name}.label`} label="Label" description="The name patients read, for example: Como funciona" />
      <TextField name={`${name}.value`} label="Value" description="The text under it, for example: Remoção de placa e tártaro" />
    </div>
  );
}

/** Um fato: rótulo e valor, a chave de faixa de preço e, se houver mais de um, o botão de remover. */
export function FactFields({ index, onRemove }: { index: number; onRemove?: () => void }) {
  const name = `facts.${index}`;
  return (
    <div className="grid gap-4 border-b border-border pb-6 last:border-b-0 last:pb-0">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name={`${name}.label`} label="Label" description="For example: Duração" />
        <TextField name={`${name}.value`} label="Value" description="For example: 30 a 50 minutos" />
      </div>
      <div className="flex items-center gap-3">
        <AssessmentSwitch name={`${name}.assessment`} />
        {onRemove && (
          <Button type="button" variant="destructive-ghost" size="icon" aria-label={`Remove fact ${index + 1}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  );
}

/** A chave "Final value depends on the assessment" (ligada grava `assessment: true`). */
function AssessmentSwitch({ name }: { name: string }) {
  const id = useId();
  const { control } = useFormContext();
  return (
    <Field orientation="horizontal" className="min-w-0 flex-1">
      <FieldContent>
        <FieldLabel htmlFor={id}>Final value depends on the assessment</FieldLabel>
        <FieldDescription>Turn it on when the price is a range. The final value is set at the assessment.</FieldDescription>
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
