import { useTranslation } from "react-i18next";
import type { Connection } from "../../api";
import { formatPhone } from "../../format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Muted } from "../Muted";

/** Bolinha do estado: verde conectado, âmbar conectando (pisca devagar, parado com movimento reduzido), cinza desconectado. */
const DOT_TONES = {
  open: "bg-ok ring-ok-bg",
  connecting: "bg-warn ring-warn-bg animate-pulse motion-reduce:animate-none",
  close: "bg-muted-foreground ring-secondary",
} as const;

/** Estado da conexão em destaque: a bolinha, o número (ou a falta dele) e, quando conectado, o botão de desconectar. */
export function StatusHero({
  connection,
  busy,
  onDisconnect,
}: {
  connection: Connection;
  busy: boolean;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation("connection");
  const connected = connection.state === "open";

  return (
    <section className="grid gap-3 rounded-xl border border-border bg-card p-6 max-md:p-4">
      <div className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
        <span aria-hidden="true" className={cn("size-2.5 rounded-full ring-4", DOT_TONES[connection.state])} />
        {t(`status.${connection.state}`)}
      </div>
      {connected ? (
        <>
          <p className="m-0 text-3xl font-bold tracking-tight tnum">
            {connection.number ? formatPhone(connection.number) : t("connected.unknownNumber")}
          </p>
          <Muted as="p">{t("connected.note")}</Muted>
          <Button variant="destructive-ghost" className="justify-self-start" onClick={onDisconnect} disabled={busy}>
            {busy ? t("connected.disconnecting") : t("connected.disconnect")}
          </Button>
        </>
      ) : (
        <Muted as="p">{t("connect.noNumber")}</Muted>
      )}
    </section>
  );
}
