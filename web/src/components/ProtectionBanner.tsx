import type { Protection } from "../api";

const REASONS: Record<NonNullable<Protection["reason"]>, string> = {
  send_failures: "too many send failures",
  connection_drops: "the connection dropped several times",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" });

/** Estado da proteção do número: nada no normal; aviso no aquecimento; alerta com o freio ativo (specs/004 FR-028). */
export function ProtectionBanner({ protection }: { protection: Protection | null }) {
  if (!protection || protection.state === "normal") return null;
  if (protection.state === "paused") {
    return (
      <div className="protection-banner paused" role="alert">
        🛡️ Automatic sending paused by number protection
        {protection.reason ? ` (${REASONS[protection.reason]})` : ""}
        {protection.pausedUntil ? ` until ${time(protection.pausedUntil)}` : ""}. The assistant will not reply until then.
      </div>
    );
  }
  return (
    <div className="protection-banner warmup" role="status">
      🌱 Number warming up{protection.warmupUntil ? ` until ${day(protection.warmupUntil)}` : ""}: reduced limits (
      {protection.limits.conversationsPerDay} conversations per day).
    </div>
  );
}
