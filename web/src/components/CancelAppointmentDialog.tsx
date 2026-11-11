import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, cancelAppointment, type Appointment } from "../api";
import type { useFormats } from "../i18n/formats";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "./Notice";
import { Title } from "./Title";

/** Confirmação antes de cancelar um agendamento: remove o evento da agenda e não avisa o cliente. */
export function CancelAppointmentDialog({
  appointment,
  formats,
  onKeep,
  onCancelled,
  onGone,
}: {
  appointment: Appointment;
  formats: ReturnType<typeof useFormats>;
  onKeep: () => void;
  onCancelled: () => void;
  /** O agendamento já não existe: fecha o diálogo e a lista recarrega. */
  onGone: () => void;
}) {
  const { t } = useTranslation("appointments");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = new Date(appointment.startsAt);
  const when = t("cancelDialog.when", { day: formats.day.format(start), time: formats.time.format(start) });
  const who = appointment.service
    ? t("cancelDialog.who", { name: appointment.customerName, service: appointment.service })
    : appointment.customerName;

  /** Mensagem para o erro do cancelamento; not_found fecha o diálogo e recarrega a lista (em confirm). */
  function cancelReason(err: unknown): string {
    if (err instanceof ApiError && err.error === "calendar_disconnected") return t("errors.calendar_disconnected");
    return t("errors.cancel");
  }

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
            <Title level={3}>{t("cancelDialog.title")}</Title>
          </DialogTitle>
          <DialogDescription>{t("cancelDialog.description", { who, when })}</DialogDescription>
        </DialogHeader>
        {error ? (
          <DialogBody>
            <Notice role="alert">{error}</Notice>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onKeep} disabled={busy} autoFocus>
            {t("cancelDialog.keep")}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? t("cancelDialog.busy") : t("cancelDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
