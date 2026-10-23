import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, risksOf, sendMessage, type Message, type SendRisk } from "../api";
import { RiskDialog } from "./RiskDialog";

const MAX_LENGTH = 4096;

export function Composer({
  conversationId,
  connected,
  onSent,
}: {
  conversationId: string;
  connected: boolean;
  onSent: (m: Message) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Riscos de banimento que o operador precisa confirmar antes de enviar (specs/004, US4)
  const [risks, setRisks] = useState<SendRisk[] | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // Altura automática, até o limite do CSS
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    // Barra de rolagem só quando passa da altura máxima do CSS
    el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? "auto" : "hidden";
  }, [text]);

  const canSend = connected && !busy && text.trim().length > 0;

  async function send(confirmRisk = false) {
    if (!canSend) return;
    setBusy(true);
    setNotice(null);
    setRisks(null);
    try {
      const { message } = await sendMessage(conversationId, text, confirmRisk);
      onSent(message);
      setText("");
    } catch (err) {
      const pending = risksOf(err);
      if (pending) {
        setRisks(pending);
      } else if (err instanceof ApiError && err.error === "whatsapp_disconnected") {
        setNotice("WhatsApp desconectado: a mensagem não foi enviada.");
      } else if (err instanceof ApiError && err.status === 502 && err.body.message) {
        // Ficou registrada como "não enviada" no histórico, com a opção de tentar de novo
        onSent(err.body.message as Message);
        setText("");
      } else {
        setNotice("Não foi possível enviar. Tente de novo.");
      }
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <footer className="composer">
      {!connected && <p className="notice">WhatsApp desconectado: conecte o número para enviar mensagens.</p>}
      {notice && connected && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <div className="composer-row">
        <textarea
          ref={area}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder="Escreva uma mensagem (Enter envia, Shift+Enter quebra a linha)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="primary" onClick={() => void send()} disabled={!canSend}>
          {busy ? "Enviando…" : "Enviar"}
        </button>
      </div>
      {risks && <RiskDialog risks={risks} onCancel={() => setRisks(null)} onConfirm={() => void send(true)} />}
    </footer>
  );
}
