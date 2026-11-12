import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateCustomer, type Customer, type CustomerAppointment } from "../../api";
import { formatPhone } from "../../format";
import type { useFormats } from "../../i18n/formats";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Muted } from "../Muted";
import { Title } from "../Title";
import { serverErrorKey } from "./customer-errors";

const MAX_NOTES = 1000;

type Formats = ReturnType<typeof useFormats>;

/** Ficha aberta: nome editável, anotações, conversa e exclusão (specs/006 US2). */
export function CustomerDetail({
  customer: c,
  formats,
  label,
  onSaved,
  onDelete,
  deleting,
}: {
  customer: Customer;
  formats: Formats;
  label: (a: CustomerAppointment) => string;
  onSaved: (c: Customer) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation("customers");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [notes, setNotes] = useState(c.notes ?? "");
  const [saving, setSaving] = useState<"name" | "notes" | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // A lista recarrega com customers.updated: o campo de anotações acompanha se não estiver sendo editado
  useEffect(() => {
    if (saving === null) setNotes(c.notes ?? "");
  }, [c.notes]);

  async function save(field: "name" | "notes") {
    setSaving(field);
    setMessage(null);
    try {
      const { customer, calendarUpdated } = await updateCustomer(c.id, field === "name" ? { name } : { notes: notes.trim() ? notes : null });
      onSaved(customer);
      if (field === "name") {
        setEditing(false);
        setMessage(
          calendarUpdated ? { text: t("saved.name"), ok: true } : { text: t("saved.nameCalendarWarning"), ok: false },
        );
      } else {
        setMessage({ text: t("saved.notes"), ok: true });
      }
    } catch (err) {
      setMessage({ text: t(serverErrorKey(err) ?? (field === "name" ? "errors.saveName" : "errors.saveNotes")), ok: false });
    } finally {
      setSaving(null);
    }
  }

  const notesChanged = notes !== (c.notes ?? "");

  return (
    <div className="grid gap-5 px-2 pt-1 pb-4 max-md:px-1">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg border border-border bg-card p-3.5 text-sm">
        <dt className="text-muted-foreground">{t("fields.id")}</dt>
        <dd className="m-0 font-mono text-xs wrap-anywhere">{c.id}</dd>
        <dt className="text-muted-foreground">{t("fields.name")}</dt>
        <dd className="m-0 wrap-anywhere">
          {editing ? (
            <span className="flex flex-wrap items-center gap-2">
              <Input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                aria-label={t("ariaName")}
                autoFocus
                className="min-w-0 flex-1"
              />
              <Button onClick={() => save("name")} disabled={!name.trim() || saving === "name"}>
                {saving === "name" ? t("actions.saving") : t("actions.save")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setName(c.name);
                }}
              >
                {t("actions.cancel")}
              </Button>
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              {c.name}
              <Button variant="link" onClick={() => setEditing(true)}>
                {t("actions.edit")}
              </Button>
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">{t("fields.phone")}</dt>
        <dd className="tnum m-0 wrap-anywhere">{formatPhone(c.phone)}</dd>
        <dt className="text-muted-foreground">{t("fields.created")}</dt>
        <dd className="m-0 wrap-anywhere">{formats.formatDate(c.createdAt)}</dd>
        {c.updatedAt !== c.createdAt && (
          <>
            <dt className="text-muted-foreground">{t("fields.updated")}</dt>
            <dd className="m-0 wrap-anywhere">{formats.formatDate(c.updatedAt)}</dd>
          </>
        )}
      </dl>

      {message && (
        <Muted as="p" tone={message.ok ? "ok" : "destructive"}>
          {message.text}
        </Muted>
      )}

      <div className="grid gap-2">
        <Title level={3}>{t("notesTitle")}</Title>
        <Textarea
          value={notes}
          maxLength={MAX_NOTES}
          placeholder={t("notesPlaceholder")}
          onChange={(e) => setNotes(e.target.value)}
          aria-label={t("ariaNotes")}
        />
        <div className="flex items-center justify-between gap-2">
          <Muted className="tnum">
            {notes.length}/{MAX_NOTES}
          </Muted>
          <Button variant="secondary" onClick={() => save("notes")} disabled={!notesChanged || saving === "notes"}>
            {saving === "notes" ? t("actions.saving") : t("actions.saveNotes")}
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        <Title level={3}>{t("appointmentsTitle")}</Title>
        {c.appointments.length === 0 ? (
          <Muted as="p">{t("noAppointments")}</Muted>
        ) : (
          <ul className="grid gap-2">
            {c.appointments.map((a) => {
              const cancelled = a.status === "cancelled";
              return (
                <li key={a.startsAt + a.status} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", cancelled ? "bg-muted-foreground" : "bg-ok")} />
                  <span className={cn("min-w-0", cancelled && "text-muted-foreground line-through")}>{label(a)}</span>
                  {cancelled && (
                    <Badge variant="secondary" className="font-normal text-muted-foreground">
                      {t("cancelled")}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2 max-md:[&>*]:flex-1 max-md:[&_button]:w-full">
        {c.conversationId ? (
          <Button asChild variant="secondary">
            <a href={`#/?c=${c.conversationId}`}>{t("actions.viewConversation")}</a>
          </Button>
        ) : (
          <Button variant="secondary" disabled title={t("noConversation")}>
            {t("actions.viewConversation")}
          </Button>
        )}
        <Button variant="destructive" onClick={onDelete} disabled={deleting}>
          {deleting ? t("actions.deleting") : t("actions.delete")}
        </Button>
      </div>
    </div>
  );
}
