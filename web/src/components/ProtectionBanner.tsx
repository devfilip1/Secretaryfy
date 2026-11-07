import { ShieldAlert, Sprout } from "lucide-react";
import type { Protection } from "../api";
import { formatClock, formatDay } from "../format";
import { cn } from "../lib/utils";

const REASONS: Record<NonNullable<Protection["reason"]>, string> = {
  send_failures: "too many send failures",
  connection_drops: "the connection dropped several times",
};

/** Estado da proteção do número: nada no normal; aviso no aquecimento; alerta com o freio ativo (specs/004 FR-028). */
export function ProtectionBanner({ protection }: { protection: Protection | null }) {
  if (!protection || protection.state === "normal") return null;
  const paused = protection.state === "paused";
  return (
    <div
      role={paused ? "alert" : "status"}
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-1.5 text-center text-sm",
        paused ? "bg-destructive text-white" : "border-b border-border bg-secondary text-muted-foreground",
      )}
    >
      {paused ? <ShieldAlert className="size-4 shrink-0" /> : <Sprout className="size-4 shrink-0" />}
      <span>
        {paused
          ? `Automatic sending paused by number protection${protection.reason ? ` (${REASONS[protection.reason]})` : ""}${
              protection.pausedUntil ? ` until ${formatClock(protection.pausedUntil)}` : ""
            }. The assistant will not reply until then.`
          : `Number warming up${protection.warmupUntil ? ` until ${formatDay(protection.warmupUntil)}` : ""}: reduced limits (${protection.limits.conversationsPerDay} conversations per day).`}
      </span>
    </div>
  );
}
