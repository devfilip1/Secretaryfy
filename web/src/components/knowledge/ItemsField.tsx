import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import type { TreatmentFormValues } from "./form-values";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const ITEMS = "ideal.items" as const;

/** Lista de linhas (a "Ideal para"): Enter numa linha abre outra logo abaixo, com o foco nela. */
export function ItemsField() {
  const { control, register, setFocus, formState } = useFormContext<TreatmentFormValues>();
  const { fields, insert, remove, append } = useFieldArray({ control, name: ITEMS });
  // Índice da linha que deve ganhar o foco depois que o React desenhar a nova linha
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndex.current === null) return;
    setFocus(`${ITEMS}.${focusIndex.current}.text`);
    focusIndex.current = null;
  }, [fields.length, setFocus]);

  const listError = formState.errors.ideal?.items;
  const listMessage = listError?.root?.message ?? listError?.message;

  return (
    <div className="grid gap-3">
      <Field data-invalid={listMessage ? true : undefined}>
        <FieldLabel>Items</FieldLabel>
        <FieldDescription>One short line each, for example: Hálito mais fresco. Press Enter for a new line.</FieldDescription>
      </Field>
      <ul className="grid gap-2">
        {fields.map((field, index) => (
          <li key={field.id} className="flex items-center gap-2">
            <Input
              aria-label={`Item ${index + 1}`}
              aria-invalid={formState.errors.ideal?.items?.[index]?.text ? true : undefined}
              {...register(`${ITEMS}.${index}.text`)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                focusIndex.current = index + 1;
                insert(index + 1, { text: "" });
              }}
            />
            <Button type="button" variant="destructive-ghost" size="icon" aria-label={`Remove item ${index + 1}`} onClick={() => remove(index)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <FieldError errors={[{ message: listMessage }]} />
      <div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            focusIndex.current = fields.length;
            append({ text: "" });
          }}
        >
          <Plus />
          Add item
        </Button>
      </div>
    </div>
  );
}
