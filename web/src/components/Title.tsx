import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const TAGS = { 1: "h1", 2: "h2", 3: "h3" } as const;
const SIZES = { 1: "text-3xl", 2: "text-2xl", 3: "text-lg" } as const;

/** Título da tela (h1), da seção (h2) ou do bloco (h3). Sem margem própria: quem usa define o espaçamento. */
export function Title({ level, className, ...props }: ComponentProps<"h2"> & { level: 1 | 2 | 3 }) {
  const Tag = TAGS[level];
  return <Tag className={cn("m-0 text-balance font-bold", SIZES[level], className)} {...props} />;
}
