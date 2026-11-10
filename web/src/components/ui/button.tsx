import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Desktop: controles compactos (h-9, texto de 14px, ícones de 16px). Toque (pointer-coarse): 44px de área,
// e o movimento some com prefers-reduced-motion.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-disabled pointer-coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border border-transparent bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
        secondary: "border border-border bg-secondary text-foreground hover:bg-border",
        outline: "border border-border bg-card text-foreground hover:bg-secondary",
        destructive: "border border-transparent bg-destructive text-white hover:bg-destructive/90",
        ghost: "border border-transparent bg-transparent text-foreground hover:bg-secondary",
        // Excluir: neutro até o toque ou o foco, quando ganha a cor de perigo
        "destructive-ghost":
          "border border-transparent bg-transparent text-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive",
        link: "rounded-none border-0 bg-transparent text-primary underline underline-offset-4",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5",
        icon: "size-9 pointer-coarse:min-w-11",
        "icon-sm": "size-8 pointer-coarse:min-w-11",
      },
    },
    compoundVariants: [
      // O link é texto, não um botão: sem altura nem preenchimento próprios
      { variant: "link", size: "default", class: "h-auto px-0" },
    ],
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
