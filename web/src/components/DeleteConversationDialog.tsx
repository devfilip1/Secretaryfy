import { useTranslation } from "react-i18next";
import { ApiError, deleteConversation, type Conversation } from "../api";
import { formatPhone } from "../format";
import { ActionConfirmDialog } from "./ActionConfirmDialog";

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
  const who = conversation.name || formatPhone(conversation.phone);

  /** Apaga; devolve a mensagem de erro, ou null quando o diálogo pode fechar. */
  async function remove(): Promise<string | null> {
    try {
      await deleteConversation(conversation.id);
      onDeleted();
      return null;
    } catch (err) {
      // not_found: a conversa já foi apagada (outro operador ou outra aba); fecha como apagada
      if (err instanceof ApiError && err.error === "not_found") {
        onDeleted();
        return null;
      }
      return t("deleteOne.error");
    }
  }

  return (
    <ActionConfirmDialog
      title={t("deleteOne.title")}
      description={t("deleteOne.description", { name: who })}
      keepLabel={t("deleteOne.keep")}
      confirmLabel={t("deleteOne.confirm")}
      busyLabel={t("deleteOne.busy")}
      onKeep={onKeep}
      run={remove}
    />
  );
}
