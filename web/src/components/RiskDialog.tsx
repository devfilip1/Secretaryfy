import { useTranslation } from "react-i18next";
import type { SendRisk } from "../api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Title } from "./Title";

/** Confirmação antes de o operador enviar com risco de banimento (specs/004, US4). */
export function RiskDialog({ risks, onCancel, onConfirm }: { risks: SendRisk[]; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation("inbox");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle asChild>
            <Title level={3}>{t("risk.title")}</Title>
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ul className="list-disc pl-5">
            {risks.map((risk) => (
              <li key={risk}>{t(`risk.${risk}`, { defaultValue: risk })}</li>
            ))}
          </ul>
          <DialogDescription className="mt-3">{t("risk.warning")}</DialogDescription>
        </DialogBody>
        <DialogFooter className="flex-row justify-end max-md:flex-wrap">
          <Button variant="secondary" onClick={onCancel} autoFocus>
            {t("risk.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("risk.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
