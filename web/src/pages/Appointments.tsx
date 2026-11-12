import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmAppointment, listAppointments, type Appointment, type ReminderLabel } from "../api";
import { CancelAppointmentDialog } from "../components/CancelAppointmentDialog";
import { NewAppointment } from "../components/NewAppointment";
import { DayHeader } from "../components/agenda/DayHeader";
import { DayTimeline } from "../components/agenda/DayTimeline";
import type { ReminderTag } from "../components/agenda/AgendaRow";
import { agendaDays, agendaGroups, dayItems } from "../components/agenda/day-agenda";
import { AGENDA_FETCH_DAYS, readAgendaRange, saveAgendaRange, type AgendaRange } from "../components/agenda/agenda-range";
import { RangeSwitch } from "../components/agenda/RangeSwitch";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBlockReasonText } from "../i18n/blockReason";
import { useFormats } from "../i18n/formats";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";
import { useInboxEvents } from "../useEvents";

/** Erro da tela: a chave (e o nome, se houver) fica no estado e vira texto só ao mostrar, então trocar o idioma não refaz a busca. */
type ErrorMessage = { key: "errors.load" | "errors.confirm" | "errors.notBooked"; values?: { name: string } };

/**
 * Agenda das consultas marcadas pelo assistente ou pelo painel (specs/006 US1). Alcance: Dia (com setas), 7 dias ou Mês,
 * estes dois últimos com um cabeçalho por dia que tem consulta.
 */
export function AppointmentsPage() {
  const { t } = useTranslation("appointments");
  const reasonText = useBlockReasonText();
  const [data, setData] = useState<{ timeZone: string; appointments: Appointment[] } | null>(null);
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [range, setRange] = useState<AgendaRange>(readAgendaRange);

  const load = useCallback(() => {
    listAppointments(AGENDA_FETCH_DAYS[range])
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch(() => setError({ key: "errors.load" }));
  }, [range]);
  useEffect(load, [load]);

  function chooseRange(next: AgendaRange) {
    setRange(next);
    saveAgendaRange(next);
  }

  useInboxEvents((event) => {
    if (event.type === "appointments.updated" || event.type === "customers.updated" || event.type === "reconnected") load();
  });

  const formats = useFormats(data?.timeZone);
  const errorText = error ? (error.values ? t(error.key, error.values) : t(error.key)) : null;

  /** Etiqueta da situação do lembrete e da confirmação (specs/006 data-model.md); not_needed não mostra nada. */
  function reminderTag(a: Appointment): ReminderTag | null {
    const reason = reasonText(a.reminder.reason);
    const labels: Record<ReminderLabel, ReminderTag | null> = {
      confirmed: { text: a.confirmedBy === "operator" ? t("reminder.confirmedByYou") : t("reminder.confirmed"), tone: "ok" },
      scheduled: { text: t("reminder.scheduled"), tone: "muted", title: t("reminder.scheduledHint") },
      remind_manually: { text: t("reminder.remindManually"), tone: "warn", title: t("reminder.remindManuallyHint", { reason }) },
      waiting: { text: t("reminder.waiting"), tone: "muted", title: reason },
      sent: { text: t("reminder.sent"), tone: "muted", title: t("reminder.sentHint") },
      not_sent: { text: t("reminder.notSent"), tone: "bad", title: reason },
      not_needed: null,
    };
    return labels[a.reminder.label];
  }

  async function confirm(a: Appointment) {
    setConfirming(a.id);
    try {
      const { appointment } = await confirmAppointment(a.id);
      setData((d) => d && { ...d, appointments: d.appointments.map((x) => (x.id === a.id ? appointment : x)) });
    } catch {
      setError({ key: "errors.confirm", values: { name: a.customerName } });
    } finally {
      setConfirming(null);
    }
  }

  if (!data) return <Page className="text-muted-foreground">{errorText ?? t("loading")}</Page>;

  const days = agendaDays(new Date(), data.timeZone);
  const day = days[dayIndex] ?? days[0];
  const items = dayItems(data.appointments, day.key, data.timeZone);
  const groups = agendaGroups(data.appointments, data.timeZone);

  return (
    <Page>
      <div className="w-[min(860px,100%)]">
        <Card as="section" className="w-full">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <Title level={2} className="mb-0.5">
                {t("title")}
              </Title>
              <Muted as="p">{t("subtitle")}</Muted>
            </div>
            {!creating && (
              <Button size="sm" onClick={() => setCreating(true)}>
                {t("new")}
              </Button>
            )}
          </div>

          <RangeSwitch value={range} onChange={chooseRange} />

          {notice && (
            <Notice layout="box" tone="ok" role="status" onDismiss={() => setNotice(null)}>
              {notice}
            </Notice>
          )}
          {errorText && <Notice role="alert">{errorText}</Notice>}

          {cancelling && (
            <CancelAppointmentDialog
              appointment={cancelling}
              formats={formats}
              onKeep={() => setCancelling(null)}
              onCancelled={() => {
                setNotice(
                  t("notice.cancelled", {
                    name: cancelling.customerName,
                    day: formats.day.format(new Date(cancelling.startsAt)),
                    time: formats.time.format(new Date(cancelling.startsAt)),
                  }),
                );
                setError(null);
                setData((d) => d && { ...d, appointments: d.appointments.filter((x) => x.id !== cancelling.id) });
                setCancelling(null);
              }}
              onGone={() => {
                setError({ key: "errors.notBooked" });
                setCancelling(null);
                load();
              }}
            />
          )}

          {creating && (
            <NewAppointment
              onCancel={() => setCreating(false)}
              onBooked={(a) => {
                setCreating(false);
                setNotice(
                  t("notice.booked", {
                    name: a.customerName,
                    day: formats.day.format(new Date(a.startsAt)),
                    time: formats.time.format(new Date(a.startsAt)),
                  }),
                );
                load();
              }}
            />
          )}

          {data.appointments.length === 0 ? (
            <p className="mt-6 mb-2 text-center text-muted-foreground">{range === "month" ? t("emptyMonth") : t("empty")}</p>
          ) : range === "day" ? (
            <>
              <DayHeader
                label={formats.day.format(day.date)}
                index={dayIndex}
                last={days.length - 1}
                onMove={(delta) => setDayIndex((i) => i + delta)}
                onToday={() => setDayIndex(0)}
              />
              {items.length === 0 ? (
                <p className="mt-6 mb-2 text-center text-muted-foreground">{t("agenda.emptyDay")}</p>
              ) : (
                <DayTimeline
                  items={items}
                  formats={formats}
                  tagOf={reminderTag}
                  confirmingId={confirming}
                  onConfirm={(a) => confirm(a)}
                  onCancel={(a) => setCancelling(a)}
                />
              )}
            </>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="mt-4">
                <h3 className="border-b border-border pb-2 text-sm font-semibold">{formats.day.format(new Date(group.items[0].startsAt))}</h3>
                <DayTimeline
                  items={group.items}
                  formats={formats}
                  tagOf={reminderTag}
                  confirmingId={confirming}
                  onConfirm={(a) => confirm(a)}
                  onCancel={(a) => setCancelling(a)}
                />
              </section>
            ))
          )}
        </Card>
      </div>
    </Page>
  );
}
