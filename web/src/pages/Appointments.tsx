import { useCallback, useEffect, useMemo, useState } from "react";
import { StickyNote } from "lucide-react";
import { confirmAppointment, listAppointments, type Appointment, type ReminderLabel } from "../api";
import { NewAppointment } from "../components/NewAppointment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { blockReasonText, clinicFormats, formatPhone } from "../format";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";
import { useInboxEvents } from "../useEvents";

const GROUPS: { key: Appointment["group"]; title: string }[] = [
  { key: "today", title: "Today" },
  { key: "tomorrow", title: "Tomorrow" },
  { key: "week", title: "Next 7 days" },
];

/** Etiqueta da situação do lembrete e da confirmação (specs/006 data-model.md); not_needed não mostra nada. */
function reminderTag(a: Appointment): { text: string; tone: "ok" | "warn" | "bad" | "muted"; title?: string } | null {
  const reason = blockReasonText(a.reminder.reason);
  const labels: Record<ReminderLabel, ReturnType<typeof reminderTag>> = {
    confirmed: { text: a.confirmedBy === "operator" ? "Confirmed by you" : "Confirmed", tone: "ok" },
    scheduled: { text: "Reminder scheduled", tone: "muted", title: "The WhatsApp reminder goes out from 24 h before." },
    remind_manually: { text: "Remind manually", tone: "warn", title: `${reason}. The assistant can't message this customer first.` },
    waiting: { text: "Reminder waiting", tone: "muted", title: reason },
    sent: { text: "Reminder sent", tone: "muted", title: "Waiting for the customer to reply YES." },
    not_sent: { text: "Reminder not sent", tone: "bad", title: reason },
    not_needed: null,
  };
  return labels[a.reminder.label];
}

const TAG_TONE: Record<"ok" | "warn" | "bad" | "muted", string> = {
  ok: "text-ok",
  warn: "",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

/** Próximos horários marcados pelo assistente ou pelo painel (specs/006 US1). */
export function AppointmentsPage() {
  const [data, setData] = useState<{ timeZone: string; appointments: Appointment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    listAppointments()
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch(() => setError("Could not load the appointments."));
  }, []);
  useEffect(load, [load]);

  useInboxEvents((event) => {
    if (event.type === "appointments.updated" || event.type === "customers.updated" || event.type === "reconnected") load();
  });

  const formats = useMemo(() => clinicFormats(data?.timeZone), [data?.timeZone]);

  async function confirm(a: Appointment) {
    setConfirming(a.id);
    try {
      const { appointment } = await confirmAppointment(a.id);
      setData((d) => d && { ...d, appointments: d.appointments.map((x) => (x.id === a.id ? appointment : x)) });
    } catch {
      setError(`Could not confirm ${a.customerName}'s appointment. Please try again.`);
    } finally {
      setConfirming(null);
    }
  }

  if (!data) return <Page className="text-muted-foreground">{error ?? "Loading…"}</Page>;

  return (
    <Page>
      <div className="w-[min(860px,100%)]">
        <Card as="section" className="w-full">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <Title level={2} className="mb-0.5">
                Appointments
              </Title>
              <Muted as="p">Booked by the assistant or here, for the next 7 days.</Muted>
            </div>
            {!creating && (
              <Button className="max-md:flex-1" onClick={() => setCreating(true)}>
                New appointment
              </Button>
            )}
          </div>

          {notice && (
            <Notice layout="box" tone="ok" role="status" onDismiss={() => setNotice(null)}>
              {notice}
            </Notice>
          )}
          {error && <Notice role="alert">{error}</Notice>}

          {creating && (
            <NewAppointment
              onCancel={() => setCreating(false)}
              onBooked={(a) => {
                setCreating(false);
                setNotice(`Booked ${a.customerName} for ${formats.day.format(new Date(a.startsAt))} at ${formats.time.format(new Date(a.startsAt))}.`);
                load();
              }}
            />
          )}

          {data.appointments.length === 0 ? (
            <p className="mt-6 mb-2 text-center text-muted-foreground">No appointments in the next 7 days.</p>
          ) : (
            GROUPS.map(({ key, title }) => {
              const items = data.appointments.filter((a) => a.group === key);
              if (items.length === 0) return null;
              return (
                <section key={key}>
                  <Title level={3} className="mt-4.5 mb-1.5">
                    {title} <Muted>({items.length})</Muted>
                  </Title>
                  <ul className="border-t border-border">
                    {items.map((a) => {
                      const tag = reminderTag(a);
                      const start = new Date(a.startsAt);
                      return (
                        <li
                          key={a.id}
                          className={cn(
                            "grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-1.5 py-2.5 max-md:grid-cols-[64px_minmax(0,1fr)] max-md:gap-x-2.5 max-md:gap-y-1",
                            a.reminder.label === "remind_manually" && "shadow-stripe-warn",
                          )}
                        >
                          <div className="flex flex-col tabular-nums">
                            <strong>{formats.time.format(start)}</strong>
                            {key === "week" && <Muted>{formats.day.format(start)}</Muted>}
                          </div>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate font-semibold">{a.customerName}</span>
                            <Muted>
                              {a.service ?? "-"} · {formatPhone(a.phone)}
                              {a.origin === "panel" ? " · booked here" : ""}
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
                                  title="Mark as confirmed (for example, after calling the customer)"
                                >
                                  {confirming === a.id ? "Confirming…" : "Confirm"}
                                </Button>
                              )}
                              {a.conversationId && <a href={`#/?c=${a.conversationId}`}>Open conversation</a>}
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
