import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "./Notice";
import { Title } from "./Title";

/**
 * Confirmação de uma ação com espera (cancelar, apagar): o botão mostra o estado de ocupado e o erro fica no diálogo.
 * `run` faz a ação e devolve a mensagem de erro, ou null quando deu certo (quem chama fecha a tela nesse caso).
 * Esc e clique fora contam como manter; enquanto a ação roda, nada fecha.
 */
export function ActionConfirmDialog({
  title,
  description,
  keepLabel,
  confirmLabel,
  busyLabel,
  onKeep,
  run,
}: {
  title: string;
  description: string;
  keepLabel: string;
  confirmLabel: string;
  busyLabel: string;
  onKeep: () => void;
  run: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const message = await run();
    if (message !== null) {
      setBusy(false);
      setError(message);
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
            <Title level={3}>{title}</Title>
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <DialogBody>
            <Notice role="alert">{error}</Notice>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onKeep} disabled={busy} autoFocus>
            {keepLabel}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
