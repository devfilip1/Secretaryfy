import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Área de toque de 40px em todas as variantes. Só as propriedades listadas transitam; o toque encolhe um pouco e
// o movimento some com prefers-reduced-motion.
const buttonVariants = cva(
  "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-base whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-transparent bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
        secondary: "border border-border bg-secondary text-foreground hover:bg-border",
        destructive: "border border-transparent bg-destructive text-white hover:bg-destructive/90",
        ghost: "border border-transparent bg-transparent text-foreground hover:bg-secondary",
        // Excluir: neutro até o toque ou o foco, quando ganha a cor de perigo
        "destructive-ghost":
          "border border-transparent bg-transparent text-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive",
        link: "rounded-none border-0 bg-transparent p-0 text-primary underline underline-offset-4",
      },
      size: {
        default: "",
        icon: "size-10 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
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
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
