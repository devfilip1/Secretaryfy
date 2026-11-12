import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
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

/** Painel do cliente selecionado: nome editável, dados, anotações, consultas e ações (specs/006 US2). No celular, ocupa a tela toda e tem Voltar. */
export function CustomerDetail({
  customer: c,
  next,
  formats,
  label,
  onSaved,
  onDelete,
  deleting,
  onBack,
}: {
  customer: Customer;
  next: CustomerAppointment | null;
  formats: Formats;
  label: (a: CustomerAppointment) => string;
  onSaved: (c: Customer) => void;
  onDelete: () => void;
  deleting: boolean;
  onBack: () => void;
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
  const total = c.appointments.length;

  return (
    <div className="grid content-start gap-5 p-4 md:p-5">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" className="-ml-2 md:hidden" onClick={onBack} aria-label={t("actions.back")}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <div className="grid min-w-0 flex-1 gap-1">
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
              <Title level={3} className="wrap-anywhere">
                {c.name}
              </Title>
              <Button variant="link" onClick={() => setEditing(true)}>
                {t("actions.edit")}
              </Button>
            </span>
          )}
          <Muted>{t("since", { date: formats.formatDate(c.createdAt) })}</Muted>
        </div>
      </div>

      {/* Rótulo em cima do valor: a coluna do valor ocupa a largura toda e o telefone e "Nenhum horário futuro" não quebram */}
      <dl className="grid gap-3 rounded-lg border border-border bg-card p-3.5 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">{t("fields.phone")}</dt>
          <dd className="tnum m-0 whitespace-nowrap">{formatPhone(c.phone)}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">{t("fields.next")}</dt>
          <dd className="m-0 wrap-anywhere">{next ? label(next) : t("noUpcoming")}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">{t("fields.total")}</dt>
          <dd className="tnum m-0">{t("totalAppointments", { count: total })}</dd>
        </div>
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

      <div className="flex flex-wrap gap-2 max-md:[&>*]:flex-1 max-md:[&_button]:w-full">
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
