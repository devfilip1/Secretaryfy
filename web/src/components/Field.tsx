import type { ComponentProps } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Rótulo com o controle dentro, em coluna. */
export function Field({ className, ...props }: ComponentProps<typeof Label>) {
  return <Label className={cn("grid gap-1", className)} {...props} />;
}
