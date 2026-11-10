import { useState } from "react";
import { ApiError, cancelAppointment, type Appointment } from "../api";
import type { ClinicFormats } from "../format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "./Notice";
import { Title } from "./Title";

/** Mensagem para o erro do cancelamento; not_found fecha o diálogo e recarrega a lista. */
function cancelReason(err: unknown): string {
  if (err instanceof ApiError && err.error === "calendar_disconnected") {
    return "The calendar is disconnected. Reconnect it in the Calendar tab.";
  }
  return "Could not cancel the appointment. Please try again.";
}

/** Confirmação antes de cancelar um agendamento: remove o evento da agenda e não avisa o cliente. */
export function CancelAppointmentDialog({
  appointment,
  formats,
  onKeep,
  onCancelled,
  onGone,
}: {
  appointment: Appointment;
  formats: ClinicFormats;
  onKeep: () => void;
  onCancelled: () => void;
  /** O agendamento já não existe: fecha o diálogo e a lista recarrega. */
  onGone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = new Date(appointment.startsAt);
  const when = `${formats.day.format(start)} at ${formats.time.format(start)}`;
  const who = [appointment.customerName, appointment.service].filter(Boolean).join(", ");

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await cancelAppointment(appointment.id);
      onCancelled();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.error === "not_found") onGone();
      else setError(cancelReason(err));
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
            <Title level={3}>Cancel this appointment?</Title>
          </DialogTitle>
          <DialogDescription>
            {`${who}, ${when}. The event is removed from the calendar. No message is sent to the customer.`}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <DialogBody>
            <Notice role="alert">{error}</Notice>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onKeep} disabled={busy} autoFocus>
            Keep it
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? "Cancelling…" : "Cancel appointment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
