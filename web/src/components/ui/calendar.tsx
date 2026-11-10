"use client"

import * as React from "react"
import { DayButton, DayPicker, getDefaultClassNames, labelDayButton, type Modifiers } from "react-day-picker"
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

// Calendário shadcn sobre react-day-picker v9. Célula de 32px; no toque (pointer-coarse) 44px.
// Dia escolhido em primary, hoje com fundo accent, dias de outro mês esmaecidos, desabilitados apagados.
// As cores de estado ficam no botão do dia (CalendarDayButton), que tem o modificador de cada dia.

/** Estado do dia em texto para o leitor de tela: a cor do pontinho sozinha não basta. */
function statusSuffix(modifiers: Modifiers) {
  if (modifiers.free) return ", free times"
  if (modifiers.full) return ", fully booked"
  return ""
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar bg-background p-3 [--cell-size:--spacing(8)] pointer-coarse:[--cell-size:--spacing(11)]",
        className
      )}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4 md:flex-row", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn("absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1", defaultClassNames.nav),
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "size-(--cell-size) p-0 aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "size-(--cell-size) p-0 aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        caption_label: cn("text-sm font-medium select-none", defaultClassNames.caption_label),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn("flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none", defaultClassNames.weekday),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        day: cn("group/day relative aspect-square h-full w-full p-0 text-center select-none", defaultClassNames.day),
        today: cn("rounded-md", defaultClassNames.today),
        selected: cn("rounded-md", defaultClassNames.selected),
        outside: cn("text-muted-foreground aria-selected:text-muted-foreground", defaultClassNames.outside),
        disabled: cn("text-muted-foreground opacity-50", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      labels={{
        labelDayButton: (date, modifiers, options, dateLib) =>
          `${labelDayButton(date, modifiers, options, dateLib)}${statusSuffix(modifiers)}`,
      }}
      components={{
        Chevron: ({ className, orientation }) => {
          if (orientation === "left") return <ChevronLeftIcon className={cn("size-4", className)} />
          if (orientation === "right") return <ChevronRightIcon className={cn("size-4", className)} />
          return <ChevronDownIcon className={cn("size-4", className)} />
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  )
}

/**
 * Botão de um dia. Os modificadores `free` (há horário livre, pontinho verde) e `full` (aberto mas lotado, pontinho
 * vermelho) vêm do painel; dia fechado não tem nenhum. Com o dia escolhido, o pontinho segue a cor do texto.
 */
function CalendarDayButton({
  className,
  day,
  modifiers,
  children,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <button
      ref={ref}
      type="button"
      data-slot="calendar-day"
      aria-label={`${labelDayButton(day.date, modifiers)}${statusSuffix(modifiers)}`}
      title={modifiers.free ? "Free times" : modifiers.full ? "Fully booked" : undefined}
      className={cn(
        "relative flex aspect-square size-(--cell-size) w-full min-w-(--cell-size) flex-col items-center justify-center gap-1 rounded-md text-sm leading-none font-normal outline-hidden hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
        modifiers.today && !modifiers.selected && "bg-accent font-semibold text-accent-foreground",
        modifiers.selected && "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
        modifiers.outside && !modifiers.selected && "text-muted-foreground",
        modifiers.disabled && "text-muted-foreground opacity-50",
        className
      )}
      {...props}
    >
      {children}
      {modifiers.free && (
        <span aria-hidden="true" className={cn("absolute bottom-1 size-1 rounded-full", modifiers.selected ? "bg-current" : "bg-ok")} />
      )}
      {modifiers.full && (
        <span
          aria-hidden="true"
          className={cn("absolute bottom-1 size-1 rounded-full", modifiers.selected ? "bg-current" : "bg-destructive")}
        />
      )}
    </button>
  )
}

export { Calendar, CalendarDayButton }
