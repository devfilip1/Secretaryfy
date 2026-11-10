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
            <Title level={3}>Change the assistant language?</Title>
          </DialogTitle>
          <DialogDescription>
            {`From the next message the assistant will answer in ${languageLabel}. The brochure text is not translated: if it is written in the other language, update it too.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Change language</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
