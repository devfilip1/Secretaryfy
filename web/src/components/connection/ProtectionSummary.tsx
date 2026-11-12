import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getProtection, type Protection } from "../../api";
import { useFormats } from "../../i18n/formats";
import { cn } from "@/lib/utils";
import { Muted } from "../Muted";
import { Title } from "../Title";

const STATE_TONES = { normal: "text-ok", warmup: "text-warn", paused: "text-destructive" } as const;

/** Superfície da seção, igual à do estado da conexão. */
function Section({ children }: { children: ReactNode }) {
  return <section className="grid gap-4 rounded-xl border border-border bg-card p-5 max-md:p-4">{children}</section>;
}

/** Barra de um limite: uso atual sobre o limite real da API. Fica vermelha quando chega ao limite. */
function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tnum">
          {used} / {limit}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
            used >= limit ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** Proteção do número: estado em uma frase e os limites atuais, só com valores que a API devolveu. Lê de novo quando refreshKey muda (estado da conexão). */
export function ProtectionSummary({ refreshKey }: { refreshKey: string }) {
  const { t } = useTranslation("connection");
  const { formatClock, formatDay } = useFormats();
  const [protection, setProtection] = useState<Protection | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    getProtection()
      .then((p) => {
        if (!current) return;
        setProtection(p);
        setFailed(false);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [refreshKey]);

  if (failed) {
    return (
      <Section>
        <Title level={3}>{t("protection.title")}</Title>
        <Muted as="p">{t("protection.unavailable")}</Muted>
      </Section>
    );
  }
  if (!protection) return null;

  const { state, limits, usage } = protection;
  const statusText =
    state === "paused"
      ? t("protection.paused")
      : state === "warmup"
        ? protection.warmupUntil
          ? t("protection.warmingUpUntil", { day: formatDay(protection.warmupUntil) })
          : t("protection.warmingUp")
        : t("protection.normal");

  return (
    <Section>
      <div className="grid gap-1.5">
        <Title level={3}>{t("protection.title")}</Title>
        <p className={cn("m-0 text-sm font-medium", STATE_TONES[state])}>{statusText}</p>
        {state === "paused" && protection.pausedUntil && (
          <Muted as="p">{t("protection.pausedUntil", { time: formatClock(protection.pausedUntil) })}</Muted>
        )}
        {state === "paused" && protection.reason && (
          <Muted as="p">{t("protection.reason", { reason: t(`protection.reasons.${protection.reason}`) })}</Muted>
        )}
      </div>
      <div className="grid gap-3">
        <Meter label={t("protection.perMinute")} used={usage.lastMinute} limit={limits.perMinute} />
        <Meter label={t("protection.perHour")} used={usage.lastHour} limit={limits.perHour} />
        <Meter label={t("protection.conversationsToday")} used={usage.conversationsToday} limit={limits.conversationsPerDay} />
      </div>
      <Muted as="p">{t("protection.footnote")}</Muted>
    </Section>
  );
}
