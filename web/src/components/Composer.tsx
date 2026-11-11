import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, risksOf, sendMessage, type Message, type SendRisk } from "../api";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Notice } from "./Notice";
import { RiskDialog } from "./RiskDialog";

const MAX_LENGTH = 4096;
// No celular (tela de toque), Enter quebra a linha como no WhatsApp; envia pelo botão
const TOUCH = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** Chave de inbox.json do aviso de envio que falhou; guardada como chave para trocar de idioma junto com o painel. */
type NoticeKey = "errors.sendFailed" | "errors.whatsapp_disconnected";

export function Composer({
  conversationId,
  connected,
  onSent,
}: {
  conversationId: string;
  connected: boolean;
  onSent: (m: Message) => void;
}) {
  const { t } = useTranslation("inbox");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeKey | null>(null);
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
        setNotice("errors.whatsapp_disconnected");
      } else if (err instanceof ApiError && err.status === 502 && err.body.message) {
        // Ficou registrada como "não enviada" no histórico, com a opção de tentar de novo
        onSent(err.body.message as Message);
        setText("");
      } else {
        setNotice("errors.sendFailed");
      }
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!TOUCH && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <footer className="border-t border-border bg-card px-4 py-2.5 max-md:px-2.5 max-md:pt-2 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {!connected && <Notice tone="warn" className="mb-2 text-sm">{t("composer.disconnected")}</Notice>}
      {notice && connected && (
        <Notice tone="warn" role="alert" className="mb-2 text-sm">
          {t(notice)}
        </Notice>
      )}
      <div className="flex items-end gap-2.5">
        <Textarea
          ref={area}
          className="max-h-40 min-h-0 flex-1 resize-none"
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder={t(TOUCH ? "composer.placeholderTouch" : "composer.placeholderKeyboard")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button onClick={() => void send()} disabled={!canSend}>
          {busy ? t("composer.sending") : t("composer.send")}
        </Button>
      </div>
      {risks && <RiskDialog risks={risks} onCancel={() => setRisks(null)} onConfirm={() => void send(true)} />}
    </footer>
  );
}
