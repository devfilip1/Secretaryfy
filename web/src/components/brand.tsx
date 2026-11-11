import { cn } from "@/lib/utils";

/**
 * Marca do produto: quadradinho com a inicial e o nome. Na barra lateral (`sidebar`) o quadradinho é maior,
 * o nome vai em semibold e, recolhida, sobra só o quadradinho centralizado. O celular mantém o tamanho antigo.
 */
export function Brand({ className, sidebar = false }: { className?: string; sidebar?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", sidebar && "group-data-[collapsible=icon]:justify-center", className)}>
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center bg-primary font-bold text-primary-foreground",
          sidebar ? "size-7 rounded-lg text-xs group-data-[collapsible=icon]:size-8" : "size-6 rounded-md text-xs",
        )}
      >
        S
      </span>
      <span className={cn("truncate group-data-[collapsible=icon]:hidden", sidebar ? "text-sm font-semibold" : "font-bold")}>Secretaryfy</span>
    </span>
  );
}
