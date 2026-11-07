import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Página de uma só tela (login, painel desativado, carregamento inicial), centralizada. */
export function CenterPage({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("grid min-h-full place-items-center p-4", className)} {...props} />;
}
