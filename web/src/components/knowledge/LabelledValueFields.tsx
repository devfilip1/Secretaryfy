import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormGroup, TextField } from "./FormParts";

/** Um rótulo e o seu valor (ex.: "Preço" e "R$ 40 a R$ 85"), no nome de campo `name`. */
export function LabelledValueFields({ name, title, onRemove }: { name: string; title?: string; onRemove?: () => void }) {
  return (
    <FormGroup title={title}>
      <div className="flex items-start gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2 max-md:grid-cols-1">
          <TextField name={`${name}.label`} label="Label" />
          <TextField name={`${name}.value`} label="Value" />
        </div>
        {onRemove && (
          <Button type="button" variant="link" aria-label="Remove fact" onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
    </FormGroup>
  );
}
