import { useCallback, useEffect, useState } from "react";
import { ApiError, disconnect, requestQr, type Connection } from "../api";
import { formatPhone } from "../format";

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
          const at = new Date(String(err.body.retryAt)).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          setError(`Too many connection attempts. Try again at ${at}.`);
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

  if (!connection) return <main className="page muted">Loading…</main>;

  return (
    <main className="page">
      <div className="card connection">
        {connected ? (
          <>
            <h2>WhatsApp connected</h2>
            <p className="number">{connection.number ? formatPhone(connection.number) : "Connected number"}</p>
            <button className="danger" onClick={onDisconnect} disabled={busy}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        ) : (
          <>
            <h2>Connect WhatsApp</h2>
            <ol className="steps">
              <li>Open WhatsApp on your phone.</li>
              <li>
                Tap <strong>Linked devices</strong>, then <strong>Link a device</strong>.
              </li>
              <li>Point the camera at the code below.</li>
            </ol>
            {connection.qr ? (
              <img className="qr" src={connection.qr} alt="QR code to connect WhatsApp" />
            ) : connection.state === "close" && !requesting && !error ? (
              <div className="qr placeholder">
                <button onClick={fetchQr}>Generate a new QR code</button>
              </div>
            ) : (
              !error && <div className="qr placeholder">Generating QR code…</div>
            )}
            {error && (
              <div className="error" role="alert">
                <p>{error}</p>
                <button onClick={fetchQr}>Try again</button>
              </div>
            )}
            <p className="muted small">The code refreshes automatically.</p>
          </>
        )}
      </div>
    </main>
  );
}
