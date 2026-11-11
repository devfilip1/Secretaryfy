import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ApiError, disconnect, requestQr, type Connection } from "../api";
import { formatPhone } from "../format";
import { useFormats } from "../i18n/formats";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";

/** Quadro do QR code (264px no computador, largura da tela no celular); sem QR, mostra o texto ou o botão no lugar. */
function QrFrame({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto my-2 grid size-66 place-items-center rounded-lg bg-white p-2 text-muted-foreground max-md:h-auto max-md:w-[min(264px,100%)] max-md:aspect-square",
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
    if (!window.confirm(t("confirmDisconnect"))) return;
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
      <Card className="w-[min(420px,100%)] text-center">
        {connected ? (
          <>
            <Title level={2} className="mb-3">
              {t("connected.title")}
            </Title>
            <p className="my-4 text-lg font-semibold">
              {connection.number ? formatPhone(connection.number) : t("connected.unknownNumber")}
            </p>
            <Button variant="destructive" onClick={onDisconnect} disabled={busy}>
              {busy ? t("connected.disconnecting") : t("connected.disconnect")}
            </Button>
          </>
        ) : (
          <>
            <Title level={2} className="mb-3">
              {t("connect.title")}
            </Title>
            <ol className="list-decimal pl-5 text-left leading-relaxed">
              <li>{t("connect.step1")}</li>
              <li>
                <Trans i18nKey="connect.step2" ns="connection" components={{ strong: <strong /> }} />
              </li>
              <li>{t("connect.step3")}</li>
            </ol>
            {connection.qr ? (
              <QrFrame>
                <img className="size-full" src={connection.qr} alt={t("connect.qrAlt")} />
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
            <Muted as="p" className="my-4">
              {t("connect.refreshNote")}
            </Muted>
          </>
        )}
      </Card>
    </Page>
  );
}
