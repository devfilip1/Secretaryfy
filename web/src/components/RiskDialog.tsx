import type { SendRisk } from "../api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Title } from "./Title";

const RISK_TEXT: Record<SendRisk, string> = {
  cold_contact: "The customer has not written in over 24 hours.",
  opted_out: "The customer asked not to receive messages.",
  protection_paused: "Automatic sending is paused by number protection.",
};

/** Confirmação antes de o operador enviar com risco de banimento (specs/004, US4). */
export function RiskDialog({ risks, onCancel, onConfirm }: { risks: SendRisk[]; onCancel: () => void; onConfirm: () => void }) {
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
        <DialogTitle asChild>
          <Title level={3}>Send anyway?</Title>
        </DialogTitle>
        <ul className="list-disc pl-5">
          {risks.map((risk) => (
            <li key={risk}>{RISK_TEXT[risk] ?? risk}</li>
          ))}
        </ul>
        <DialogDescription>Sending anyway increases the risk of the number being banned.</DialogDescription>
        <DialogFooter className="mt-3.5 flex-row justify-end max-md:flex-wrap">
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Send anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
