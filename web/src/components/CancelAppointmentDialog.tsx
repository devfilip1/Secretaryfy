import { useTranslation } from "react-i18next";
import { ApiError, cancelAppointment, type Appointment } from "../api";
import type { useFormats } from "../i18n/formats";
import { ActionConfirmDialog } from "./ActionConfirmDialog";

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

  const start = new Date(appointment.startsAt);
  const when = t("cancelDialog.when", { day: formats.day.format(start), time: formats.time.format(start) });
  const who = appointment.service
    ? t("cancelDialog.who", { name: appointment.customerName, service: appointment.service })
    : appointment.customerName;

  /** Mensagem para o erro do cancelamento. */
  function cancelReason(err: unknown): string {
    if (err instanceof ApiError && err.error === "calendar_disconnected") return t("errors.calendar_disconnected");
    return t("errors.cancel");
  }

  /** Cancela; devolve a mensagem de erro, ou null quando o diálogo pode fechar. not_found fecha e recarrega a lista. */
  async function cancel(): Promise<string | null> {
    try {
      await cancelAppointment(appointment.id);
      onCancelled();
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.error === "not_found") {
        onGone();
        return null;
      }
      return cancelReason(err);
    }
  }

  return (
    <ActionConfirmDialog
      title={t("cancelDialog.title")}
      description={t("cancelDialog.description", { who, when })}
      keepLabel={t("cancelDialog.keep")}
      confirmLabel={t("cancelDialog.confirm")}
      busyLabel={t("cancelDialog.busy")}
      onKeep={onKeep}
      run={cancel}
    />
  );
}
