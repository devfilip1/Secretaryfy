import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-fixed min-h-18 w-full min-w-0 resize-y rounded-lg border border-border bg-card px-2.5 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-disabled",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
