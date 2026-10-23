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
          const at = new Date(String(err.body.retryAt)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          setError(`Muitas tentativas de conexão. Tente de novo às ${at}.`);
          return;
        }
        setError(
          err instanceof ApiError && err.status === 502
            ? "Evolution API indisponível. Verifique se ela está no ar."
            : "Não foi possível gerar o QR code.",
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
    if (!window.confirm("Desconectar este número do Secretaryfy? O assistente deixa de responder até conectar de novo.")) return;
    setBusy(true);
    try {
      await disconnect();
      onChange({ state: "close", number: null, qr: null });
    } catch {
      setError("Não foi possível desconectar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  if (!connection) return <main className="page muted">Carregando…</main>;

  return (
    <main className="page">
      <div className="card connection">
        {connected ? (
          <>
            <h2>WhatsApp conectado</h2>
            <p className="number">{connection.number ? formatPhone(connection.number) : "Número conectado"}</p>
            <button className="danger" onClick={onDisconnect} disabled={busy}>
              {busy ? "Desconectando…" : "Desconectar"}
            </button>
          </>
        ) : (
          <>
            <h2>Conectar o WhatsApp</h2>
            <ol className="steps">
              <li>Abra o WhatsApp no celular.</li>
              <li>
                Toque em <strong>Aparelhos conectados</strong> e depois em <strong>Conectar aparelho</strong>.
              </li>
              <li>Aponte a câmera para o código abaixo.</li>
            </ol>
            {connection.qr ? (
              <img className="qr" src={connection.qr} alt="QR code para conectar o WhatsApp" />
            ) : connection.state === "close" && !requesting && !error ? (
              <div className="qr placeholder">
                <button onClick={fetchQr}>Gerar novo QR code</button>
              </div>
            ) : (
              !error && <div className="qr placeholder">Gerando QR code…</div>
            )}
            {error && (
              <div className="error" role="alert">
                <p>{error}</p>
                <button onClick={fetchQr}>Tentar de novo</button>
              </div>
            )}
            <p className="muted small">O código é renovado automaticamente.</p>
          </>
        )}
      </div>
    </main>
  );
}
