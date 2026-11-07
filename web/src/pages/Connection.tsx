import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { ApiError, disconnect, requestQr, type Connection } from "../api";
import { formatClock, formatPhone } from "../format";
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

export function ConnectionPage({
  connection,
  onChange,
}: {
  connection: Connection | null;
  onChange: (c: Connection) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connected = connection?.state === "open";

  const [requesting, setRequesting] = useState(false);

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
          setError(`Too many connection attempts. Try again at ${formatClock(String(err.body.retryAt))}.`);
          return;
        }
        setError(
          err instanceof ApiError && err.status === 502
            ? "Evolution API unavailable. Check that it is running."
            : "Could not generate the QR code.",
        );
      });
  }, [onChange]);

  // Pede o QR code uma vez ao abrir a página; a Evolution renova o código sozinha e o evento qrcode.updated
  // traz cada novo. Pedir de novo enquanto ela conecta abre sockets duplicados e derruba o pareamento.
  const loaded = connection !== null;
  useEffect(() => {
    if (loaded && !connected) fetchQr();
  }, [loaded]);

  async function onDisconnect() {
    if (!window.confirm("Disconnect this number from Secretaryfy? The assistant stops replying until you connect again.")) return;
    setBusy(true);
    try {
      await disconnect();
      onChange({ state: "close", number: null, qr: null });
    } catch {
      setError("Could not disconnect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!connection) return <Page className="text-muted-foreground">Loading…</Page>;

  return (
    <Page>
      <Card className="w-[min(420px,100%)] text-center">
        {connected ? (
          <>
            <Title level={2} className="mb-3">
              WhatsApp connected
            </Title>
            <p className="my-4 text-lg font-semibold">{connection.number ? formatPhone(connection.number) : "Connected number"}</p>
            <Button variant="destructive" onClick={onDisconnect} disabled={busy}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
          </>
        ) : (
          <>
            <Title level={2} className="mb-3">
              Connect WhatsApp
            </Title>
            <ol className="list-decimal pl-5 text-left leading-relaxed">
              <li>Open WhatsApp on your phone.</li>
              <li>
                Tap <strong>Linked devices</strong>, then <strong>Link a device</strong>.
              </li>
              <li>Point the camera at the code below.</li>
            </ol>
            {connection.qr ? (
              <QrFrame>
                <img className="size-full" src={connection.qr} alt="QR code to connect WhatsApp" />
              </QrFrame>
            ) : connection.state === "close" && !requesting && !error ? (
              <QrFrame>
                <Button variant="secondary" onClick={fetchQr}>
                  Generate a new QR code
                </Button>
              </QrFrame>
            ) : (
              !error && <QrFrame>Generating QR code…</QrFrame>
            )}
            {error && (
              <Notice role="alert" className="grid justify-items-center gap-2">
                {error}
                <Button variant="secondary" onClick={fetchQr}>
                  Try again
                </Button>
              </Notice>
            )}
            <Muted as="p" className="my-4">
              The code refreshes automatically.
            </Muted>
          </>
        )}
      </Card>
    </Page>
  );
}
