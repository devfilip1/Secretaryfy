import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Página com rolagem própria: conteúdo no topo e centralizado na horizontal. */
export function Page({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("min-w-0 flex-1 overflow-y-auto grid grid-cols-[minmax(0,1fr)] items-start justify-items-center px-4 py-8 max-md:p-4", className)} {...props} />;
}
