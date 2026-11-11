import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { get, useFieldArray, useFormContext } from "react-hook-form";
import { useIssueText } from "./FormParts";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ItemErrors = { message?: string; root?: { message?: string } };

/** Lista de linhas ("Ideal para", "Endereço"): `name` é o campo da lista. Enter numa linha abre outra logo abaixo, com o foco nela. */
export function ItemsField({ name, label, description }: { name: string; label: string; description: string }) {
  const { t } = useTranslation("knowledge");
  const issueText = useIssueText();
  const { control, register, setFocus, formState } = useFormContext();
  const { fields, insert, remove, append } = useFieldArray({ control, name });
  // Índice da linha que deve ganhar o foco depois que o React desenhar a nova linha
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndex.current === null) return;
    setFocus(`${name}.${focusIndex.current}.text`);
    focusIndex.current = null;
  }, [fields.length, name, setFocus]);

  const listError = get(formState.errors, name) as ItemErrors | undefined;
  const listMessage = listError?.root?.message ?? listError?.message;

  return (
    <div className="grid gap-3">
      <Field data-invalid={listMessage ? true : undefined}>
        <FieldLabel>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </Field>
      <ul className="grid gap-2">
        {fields.map((field, index) => (
          <li key={field.id} className="flex items-center gap-2">
            <Input
              aria-label={t("itemsField.item", { number: index + 1 })}
              aria-invalid={get(formState.errors, `${name}.${index}.text`) ? true : undefined}
              {...register(`${name}.${index}.text`)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                focusIndex.current = index + 1;
                insert(index + 1, { text: "" });
              }}
            />
            <Button
              type="button"
              variant="destructive-ghost"
              size="icon-sm"
              aria-label={t("itemsField.removeItem", { number: index + 1 })}
              onClick={() => remove(index)}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <FieldError errors={[{ message: issueText(listMessage) }]} />
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
          {t("itemsField.add")}
        </Button>
      </div>
    </div>
  );
}
