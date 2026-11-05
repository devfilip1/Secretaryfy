import * as React from "react"
import { cn } from "@/lib/utils"

// Texto de 16px (text-base) em todos os tamanhos: no celular o navegador não dá zoom ao focar.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 rounded-lg border border-border bg-card px-2.5 py-2 text-base text-foreground transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-disabled",
        className
      )}
      {...props}
    />
  )
}

export { Input }
