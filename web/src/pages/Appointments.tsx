import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StickyNote } from "lucide-react";
import { confirmAppointment, listAppointments, type Appointment, type ReminderLabel } from "../api";
import { CancelAppointmentDialog } from "../components/CancelAppointmentDialog";
import { NewAppointment } from "../components/NewAppointment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPhone } from "../format";
import { useBlockReasonText } from "../i18n/blockReason";
import { useFormats } from "../i18n/formats";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";
import { useInboxEvents } from "../useEvents";

const GROUPS: { key: Appointment["group"]; title: "groups.today" | "groups.tomorrow" | "groups.week" }[] = [
  { key: "today", title: "groups.today" },
  { key: "tomorrow", title: "groups.tomorrow" },
  { key: "week", title: "groups.week" },
];

type ReminderTag = { text: string; tone: "ok" | "warn" | "bad" | "muted"; title?: string };

const TAG_TONE: Record<"ok" | "warn" | "bad" | "muted", string> = {
  ok: "text-ok",
  warn: "",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

/** Erro da tela: a chave (e o nome, se houver) fica no estado e vira texto só ao mostrar, então trocar o idioma não refaz a busca. */
type ErrorMessage = { key: "errors.load" | "errors.confirm" | "errors.notBooked"; values?: { name: string } };

/** Próximos horários marcados pelo assistente ou pelo painel (specs/006 US1). */
export function AppointmentsPage() {
  const { t } = useTranslation("appointments");
  const reasonText = useBlockReasonText();
  const [data, setData] = useState<{ timeZone: string; appointments: Appointment[] } | null>(null);
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);

  const load = useCallback(() => {
    listAppointments()
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch(() => setError({ key: "errors.load" }));
  }, []);
  useEffect(load, [load]);

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

  // O horário inteiro: "9:00 AM – 10:00 AM"
  const range = (a: Appointment) =>
    t("range", { start: formats.time.format(new Date(a.startsAt)), end: formats.time.format(new Date(a.endsAt)) });

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
            <p className="mt-6 mb-2 text-center text-muted-foreground">{t("empty")}</p>
          ) : (
            GROUPS.map(({ key, title }) => {
              const items = data.appointments.filter((a) => a.group === key);
              if (items.length === 0) return null;
              return (
                <section key={key}>
                  <Title level={3} className="mt-4.5 mb-1.5">
                    {t(title)} <Muted>({items.length})</Muted>
                  </Title>
                  <ul className="border-t border-border">
                    {items.map((a) => {
                      const tag = reminderTag(a);
                      const start = new Date(a.startsAt);
                      return (
                        <li
                          key={a.id}
                          className={cn(
                            "grid grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-1.5 py-2.5 max-md:grid-cols-[120px_minmax(0,1fr)] max-md:gap-x-2.5 max-md:gap-y-1",
                            a.reminder.label === "remind_manually" && "shadow-stripe-warn",
                          )}
                        >
                          <div className="flex flex-col tabular-nums">
                            <strong>{range(a)}</strong>
                            <Muted>
                              {key === "week" && `${formats.day.format(start)} · `}
                              {t("minutes", { minutes: a.minutes })}
                            </Muted>
                          </div>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate font-semibold">{a.customerName}</span>
                            <Muted>
                              {t(a.origin === "panel" ? "serviceLineHere" : "serviceLine", {
                                service: a.service ?? "-",
                                phone: formatPhone(a.phone),
                              })}
                            </Muted>
                            {a.notes && (
                              <Muted tone="warn" className="wrap-anywhere">
                                <StickyNote className="mr-1 inline size-3.5" />
                                {a.notes}
                              </Muted>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1.5 max-md:col-span-full max-md:flex-row max-md:flex-wrap max-md:items-center max-md:justify-between">
                            {tag && (
                              <Badge
                                variant={tag.tone === "warn" ? "warn" : "secondary"}
                                className={cn("py-px font-normal", TAG_TONE[tag.tone])}
                                title={tag.title}
                              >
                                {tag.text}
                              </Badge>
                            )}
                            <div className="flex items-center gap-2.5 text-sm">
                              {!a.confirmedAt && (
                                <Button
                                  variant={a.reminder.label === "remind_manually" ? "default" : "secondary"}
                                  onClick={() => confirm(a)}
                                  disabled={confirming === a.id}
                                  title={t("confirm.hint")}
                                >
                                  {confirming === a.id ? t("confirm.busy") : t("confirm.button")}
                                </Button>
                              )}
                              <Button variant="outline" className="text-destructive" onClick={() => setCancelling(a)}>
                                {t("cancel")}
                              </Button>
                              {a.conversationId && <a href={`#/?c=${a.conversationId}`}>{t("openConversation")}</a>}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </Card>
      </div>
    </Page>
  );
}
