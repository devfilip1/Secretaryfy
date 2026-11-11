import { ShieldAlert, Sprout } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Protection } from "../api";
import { useFormats } from "../i18n/formats";
import { cn } from "../lib/utils";

/** Estado da proteção do número: nada no normal; aviso no aquecimento; alerta com o freio ativo (specs/004 FR-028). */
export function ProtectionBanner({ protection }: { protection: Protection | null }) {
  const { t } = useTranslation("inbox");
  const { formatClock, formatDay } = useFormats();
  if (!protection || protection.state === "normal") return null;
  const paused = protection.state === "paused";

  // Cada combinação de motivo e horário tem a própria frase em inbox.json: nada de juntar pedaços traduzidos
  const reason = protection.reason ? t(`protection.reason.${protection.reason}`) : null;
  const pausedUntil = protection.pausedUntil ? formatClock(protection.pausedUntil) : null;
  const warmupUntil = protection.warmupUntil ? formatDay(protection.warmupUntil) : null;
  const limit = protection.limits.conversationsPerDay;
  let message: string;
  if (paused && reason && pausedUntil) message = t("protection.pausedReasonUntil", { reason, time: pausedUntil });
  else if (paused && reason) message = t("protection.pausedReason", { reason });
  else if (paused && pausedUntil) message = t("protection.pausedUntil", { time: pausedUntil });
  else if (paused) message = t("protection.paused");
  else if (warmupUntil) message = t("protection.warmingUpUntil", { day: warmupUntil, limit });
  else message = t("protection.warmingUp", { limit });

  return (
    <div
      role={paused ? "alert" : "status"}
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-1.5 text-center text-sm",
        paused ? "bg-destructive text-white" : "border-b border-border bg-secondary text-muted-foreground",
      )}
    >
      {paused ? <ShieldAlert className="size-4 shrink-0" /> : <Sprout className="size-4 shrink-0" />}
      <span>{message}</span>
    </div>
  );
}
