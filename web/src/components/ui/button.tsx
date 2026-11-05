import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-base whitespace-nowrap transition-colors max-md:min-h-10 disabled:cursor-not-allowed disabled:opacity-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-transparent bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
        secondary: "border border-border bg-secondary text-foreground hover:bg-border",
        destructive: "border border-transparent bg-destructive text-white hover:bg-destructive/90",
        link: "rounded-none bg-transparent p-0 text-primary underline underline-offset-4 max-md:min-h-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
