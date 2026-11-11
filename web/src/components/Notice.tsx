import type { ComponentProps } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const TONES = {
  plain: { text: "", border: "border-border" },
  ok: { text: "text-ok", border: "border-ok" },
  warn: { text: "text-warn", border: "border-warn" },
  destructive: { text: "text-destructive", border: "border-destructive" },
} as const;

// text: só o texto colorido; box: caixa de aviso; bar: faixa com linha embaixo
const LAYOUTS = {
  text: "",
  box: "flex items-center justify-between gap-3 rounded-lg border bg-card px-3.5 py-2.5",
  bar: "border-b bg-card px-3.5 py-2",
} as const;

/** Aviso do painel. onDismiss mostra o x para fechar. */
export function Notice({
  tone = "destructive",
  layout = "text",
  onDismiss,
  className,
  children,
  ...props
}: ComponentProps<"div"> & {
  tone?: keyof typeof TONES;
  layout?: keyof typeof LAYOUTS;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const color = layout === "box" ? "" : TONES[tone].text;
  const border = layout === "text" ? "" : TONES[tone].border;
  return (
    <div className={cn(LAYOUTS[layout], color, border, className)} {...props}>
      {children}
      {onDismiss && (
        <Button variant="link" onClick={onDismiss} aria-label={t("dismissNotice")}>
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
