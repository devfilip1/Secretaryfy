import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Title } from "../Title";

/** Confirmação antes de trocar a língua da assistente: a brochura não é traduzida automaticamente. */
export function LanguageChangeDialog({
  languageLabel,
  onCancel,
  onConfirm,
}: {
  languageLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("clinic");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle asChild>
            <Title level={3}>{t("languageDialog.title")}</Title>
          </DialogTitle>
          <DialogDescription>{t("languageDialog.body", { language: languageLabel })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} autoFocus>
            {t("languageDialog.cancel")}
          </Button>
          <Button onClick={onConfirm}>{t("languageDialog.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
