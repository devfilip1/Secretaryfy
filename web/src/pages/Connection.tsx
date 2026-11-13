import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, disconnect, requestQr, type Connection } from "../api";
import { useFormats } from "../i18n/formats";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "../components/ConfirmDialog";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { PairingSteps } from "../components/connection/PairingSteps";
import { ProtectionSummary } from "../components/connection/ProtectionSummary";
import { StatusHero } from "../components/connection/StatusHero";
import { Title } from "../components/Title";

/** Quadro do QR code (264px no computador, largura da tela no celular); sem QR, mostra o texto ou o botão no lugar. O próprio QR traz o fundo claro para ler bem nos dois modos. */
function QrFrame({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto my-2 grid size-66 place-items-center rounded-lg bg-secondary p-2 text-center text-muted-foreground max-md:h-auto max-md:w-[min(264px,100%)] max-md:aspect-square",
        className,
      )}
      {...props}
    />
  );
}

/** Erro da conexão: a chave (e a hora da espera) fica no estado e vira texto só ao mostrar, então trocar o idioma não pede o QR de novo. */
type QrError = { key: "errors.generic" | "errors.unavailable" | "errors.disconnect" } | { key: "errors.too_many_attempts"; retryAt: string };

export function ConnectionPage({
  connection,
  onChange,
}: {
  connection: Connection | null;
  onChange: (c: Connection) => void;
}) {
  const { t } = useTranslation("connection");
  const { formatClock } = useFormats();
  const [error, setError] = useState<QrError | null>(null);
  const [busy, setBusy] = useState(false);
  const connected = connection?.state === "open";
  const { confirm, dialog } = useConfirm();

  const [requesting, setRequesting] = useState(false);

  /** Texto do erro na língua atual. */
  const errorText = (e: QrError) => (e.key === "errors.too_many_attempts" ? t(e.key, { time: formatClock(e.retryAt) }) : t(e.key));

  const fetchQr = useCallback(() => {
    setRequesting(true);
    requestQr()
      .finally(() => setRequesting(false))
      .then((c) => {
        setError(null);
        onChange(c);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.error === "already_connected") return;
        if (err instanceof ApiError && err.error === "too_many_attempts") {
          // Tentativas seguidas de conexão também são um sinal para o WhatsApp (specs/004 FR-029)
          setError({ key: "errors.too_many_attempts", retryAt: String(err.body.retryAt) });
          return;
        }
        setError({ key: err instanceof ApiError && err.status === 502 ? "errors.unavailable" : "errors.generic" });
      });
  }, [onChange]);

  // Pede o QR code uma vez ao abrir a página; a Evolution renova o código sozinha e o evento qrcode.updated
  // traz cada novo. Pedir de novo enquanto ela conecta abre sockets duplicados e derruba o pareamento.
  const loaded = connection !== null;
  useEffect(() => {
    if (loaded && !connected) fetchQr();
  }, [loaded]);

  async function onDisconnect() {
    const ok = await confirm({
      title: t("confirmDisconnectTitle"),
      description: t("confirmDisconnect"),
      confirmLabel: t("confirmDisconnectAction"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await disconnect();
      onChange({ state: "close", number: null, qr: null });
    } catch {
      setError({ key: "errors.disconnect" });
    } finally {
      setBusy(false);
    }
  }

  if (!connection) return <Page className="text-muted-foreground">{t("loading")}</Page>;

  return (
    <Page>
      {dialog}
      <div className="grid w-[min(520px,100%)] gap-4">
        <StatusHero connection={connection} busy={busy} onDisconnect={onDisconnect} />
        {!connected && (
          <section className="grid gap-4 rounded-xl border border-border bg-card p-5 max-md:p-4">
            <div className="grid gap-1">
              <Title level={2}>{t("connect.title")}</Title>
              <Muted as="p">{t("connect.lead")}</Muted>
            </div>
            <PairingSteps />
            {connection.qr ? (
              <QrFrame>
                <img className="size-full rounded-md" src={connection.qr} alt={t("connect.qrAlt")} />
              </QrFrame>
            ) : connection.state === "close" && !requesting && !error ? (
              <QrFrame>
                <Button variant="secondary" onClick={fetchQr}>
                  {t("connect.generate")}
                </Button>
              </QrFrame>
            ) : (
              !error && <QrFrame>{t("connect.generating")}</QrFrame>
            )}
            {error && (
              <Notice role="alert" className="grid justify-items-center gap-2">
                {errorText(error)}
                <Button variant="secondary" onClick={fetchQr}>
                  {t("tryAgain")}
                </Button>
              </Notice>
            )}
            <Muted as="p">{t("connect.refreshNote")}</Muted>
          </section>
        )}
        <ProtectionSummary refreshKey={connection.state} />
      </div>
    </Page>
  );
}
