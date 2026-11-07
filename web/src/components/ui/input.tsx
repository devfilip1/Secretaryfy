import * as React from "react"
import { cn } from "@/lib/utils"

// Desktop: h-9 com texto de 14px. Toque: 44px e texto de 16px (o navegador do celular dá zoom ao focar um campo menor).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-disabled pointer-coarse:min-h-11 pointer-coarse:text-base",
        className
      )}
      {...props}
    />
  )
}

export { Input }
