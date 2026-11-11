import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, deleteConversation, type Conversation } from "../api";
import { formatPhone } from "../format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "./Notice";
import { Title } from "./Title";

/** Confirmação antes de apagar uma conversa: some com as mensagens do painel; o cliente e os agendamentos ficam. */
export function DeleteConversationDialog({
  conversation,
  onKeep,
  onDeleted,
}: {
  conversation: Conversation;
  onKeep: () => void;
  /** A conversa saiu (apagada agora ou já não existia): a tela tira da lista e fecha. */
  onDeleted: () => void;
}) {
  const { t } = useTranslation("inbox");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = conversation.name || formatPhone(conversation.phone);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await deleteConversation(conversation.id);
      onDeleted();
    } catch (err) {
      setBusy(false);
      // not_found: a conversa já foi apagada (outro operador ou outra aba); fecha como apagada
      if (err instanceof ApiError && err.error === "not_found") onDeleted();
      else setError(t("deleteOne.error"));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onKeep();
      }}
    >
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle asChild>
            <Title level={3}>{t("deleteOne.title")}</Title>
          </DialogTitle>
          <DialogDescription>{t("deleteOne.description", { name: who })}</DialogDescription>
        </DialogHeader>
        {error ? (
          <DialogBody>
            <Notice role="alert">{error}</Notice>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onKeep} disabled={busy} autoFocus>
            {t("deleteOne.keep")}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? t("deleteOne.busy") : t("deleteOne.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
