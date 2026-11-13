import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Title } from "./Title";

export type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = { options: ConfirmOptions; resolve: (ok: boolean) => void };

/**
 * Substitui window.confirm por um diálogo do painel. `confirm` devolve uma promise com a resposta;
 * Esc, clique fora e o botão de fechar contam como cancelar. Renderize `dialog` uma vez na tela.
 */
export function useConfirm() {
  const { t } = useTranslation("common");
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  );

  function settle(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  const dialog: ReactNode = pending ? (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle asChild>
            <Title level={3}>{pending.options.title}</Title>
          </DialogTitle>
          <DialogDescription className="whitespace-pre-line">{pending.options.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => settle(false)} autoFocus>
            {pending.options.cancelLabel ?? t("cancel")}
          </Button>
          <Button variant={pending.options.destructive ? "destructive" : "default"} onClick={() => settle(true)}>
            {pending.options.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { confirm, dialog };
}
