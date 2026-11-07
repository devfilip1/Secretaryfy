import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  muted: "text-muted-foreground",
  destructive: "text-destructive",
  ok: "text-ok",
  warn: "text-warn",
} as const;

/** Texto pequeno de apoio (14px). Use tone para avisos curtos; as="p" quando for parágrafo. */
export function Muted({
  as: Tag = "span",
  tone = "muted",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "span" | "p"; tone?: keyof typeof TONES }) {
  return <Tag className={cn("text-sm text-pretty", TONES[tone], className)} {...props} />;
}
