import type { Protection } from "../api";

const REASONS: Record<NonNullable<Protection["reason"]>, string> = {
  send_failures: "muitas falhas de envio",
  connection_drops: "a conexão caiu várias vezes",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Estado da proteção do número: nada no normal; aviso no aquecimento; alerta com o freio ativo (specs/004 FR-028). */
export function ProtectionBanner({ protection }: { protection: Protection | null }) {
  if (!protection || protection.state === "normal") return null;
  if (protection.state === "paused") {
    return (
      <div className="protection-banner paused" role="alert">
        🛡️ Envios automáticos pausados pela proteção do número
        {protection.reason ? ` (${REASONS[protection.reason]})` : ""}
        {protection.pausedUntil ? ` até ${time(protection.pausedUntil)}` : ""}. O assistente não responde até lá.
      </div>
    );
  }
  return (
    <div className="protection-banner warmup" role="status">
      🌱 Número em aquecimento{protection.warmupUntil ? ` até ${day(protection.warmupUntil)}` : ""}: limites reduzidos (
      {protection.limits.conversationsPerDay} conversas por dia).
    </div>
  );
}
