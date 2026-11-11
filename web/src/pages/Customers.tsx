import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, StickyNote } from "lucide-react";
import { ApiError, deleteCustomer, listCustomers, updateCustomer, type Customer, type CustomerAppointment } from "../api";
import { formatPhone } from "../format";
import { useFormats } from "../i18n/formats";
import { useInboxEvents } from "../useEvents";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";

const MAX_NOTES = 1000;

type Formats = ReturnType<typeof useFormats>;

/** Próximo horário marcado, se houver. */
function nextAppointment(c: Customer): CustomerAppointment | null {
  const now = Date.now();
  const future = c.appointments.filter((a) => a.status === "booked" && new Date(a.startsAt).getTime() > now);
  return future.at(-1) ?? null; // a lista vem dos mais recentes para os mais antigos
}

/** Erro do servidor com texto próprio; qualquer outro usa o texto genérico da ação. */
function serverErrorKey(err: unknown): "errors.notFound" | "errors.invalidBody" | undefined {
  if (!(err instanceof ApiError)) return undefined;
  if (err.error === "not_found") return "errors.notFound";
  if (err.error === "invalid_body") return "errors.invalidBody";
  return undefined;
}

/** Erro da lista: a chave (e o nome) fica no estado e vira texto só ao mostrar, então trocar o idioma não refaz a busca. */
type ErrorMessage = { key: "errors.load" | "errors.notFound" | "errors.invalidBody" | "errors.delete"; values?: { name: string } };

/** Cadastro de clientes: quem já confirmou um horário (specs/005), com edição e anotações (specs/006). */
export function CustomersPage() {
  const { t } = useTranslation("customers");
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [timeZone, setTimeZone] = useState<string | undefined>();
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const formats = useFormats(timeZone);
  const errorText = error ? (error.values ? t(error.key, error.values) : t(error.key)) : null;

  const load = useCallback(() => {
    listCustomers()
      .then((r) => {
        setCustomers(r.customers);
        setTimeZone(r.timeZone);
        setError(null);
      })
      .catch((err) => setError({ key: serverErrorKey(err) ?? "errors.load" }));
  }, []);
  useEffect(load, [load]);

  useInboxEvents((event) => {
    if (event.type === "customers.updated" || event.type === "reconnected") load();
  });

  /** Dia e hora do agendamento no fuso da clínica, com o serviço se houver. */
  const label = (a: CustomerAppointment) => {
    const when = new Date(a.startsAt);
    const at = t("appointmentAt", { day: formats.day.format(when), time: formats.time.format(when) });
    return a.service ? t("appointmentWithService", { when: at, service: a.service }) : at;
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    if (!customers || !q) return customers ?? [];
    return customers.filter((c) => c.name.toLowerCase().includes(q) || (digits && c.phone.includes(digits)));
  }, [customers, query]);

  function replace(updated: Customer) {
    setCustomers((list) => list?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
  }

  async function remove(c: Customer) {
    const ok = window.confirm(t("confirmDelete", { name: c.name, phone: formatPhone(c.phone) }));
    if (!ok) return;
    setDeleting(c.id);
    try {
      await deleteCustomer(c.id);
      setCustomers((list) => list?.filter((x) => x.id !== c.id) ?? null);
      setError(null);
    } catch (err) {
      setError({ key: serverErrorKey(err) ?? "errors.delete", values: { name: c.name } });
    } finally {
      setDeleting(null);
    }
  }

  if (!customers) return <Page className="text-muted-foreground">{errorText ?? t("loading")}</Page>;

  return (
    <Page>
      <div className="w-[min(820px,100%)]">
        <Card as="section" className="w-full">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <Title level={2} className="mb-0.5">
                {t("title")}
              </Title>
              <Muted as="p">{t("count", { count: customers.length })}</Muted>
            </div>
            <Input
              type="search"
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("searchLabel")}
              className="w-[min(280px,100%)] max-md:w-full"
            />
          </div>
          {errorText && <Notice role="alert">{errorText}</Notice>}
          {customers.length === 0 || shown.length === 0 ? (
            <p className="mt-6 mb-2 text-center text-muted-foreground">
              {customers.length === 0 ? t("empty") : t("noResults", { query })}
            </p>
          ) : (
            <ul className="border-t border-border">
              {shown.map((c) => {
                const next = nextAppointment(c);
                const expanded = open === c.id;
                return (
                  <li key={c.id} className="border-b border-border">
                    <button
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] items-center gap-3 px-1.5 py-3 text-left max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-0.5 max-md:px-1",
                        expanded ? "bg-muted" : "hover:bg-muted",
                      )}
                      onClick={() => setOpen(expanded ? null : c.id)}
                      aria-expanded={expanded}
                    >
                      <span className="truncate font-semibold">{c.name}</span>
                      <span className="tabular-nums max-md:col-start-1">{formatPhone(c.phone)}</span>
                      <Muted className="max-md:col-start-1">
                        {next ? t("nextAppointment", { when: label(next) }) : t("noUpcoming")}
                      </Muted>
                      {expanded ? (
                        <ChevronDown className="size-4 text-muted-foreground max-md:col-start-2 max-md:row-start-1" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground max-md:col-start-2 max-md:row-start-1" aria-hidden="true" />
                      )}
                      {c.notes && !expanded && (
                        <Muted tone="warn" className="col-span-full truncate">
                          <StickyNote className="mr-1 inline size-3.5" />
                          {c.notes}
                        </Muted>
                      )}
                    </button>
                    {expanded && (
                      <CustomerDetail
                        customer={c}
                        formats={formats}
                        label={label}
                        onSaved={replace}
                        onDelete={() => remove(c)}
                        deleting={deleting === c.id}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
}

/** Ficha aberta: nome editável, anotações, conversa e exclusão (specs/006 US2). */
function CustomerDetail({
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
    <div className="px-1.5 pt-1 pb-3.5">
      <dl className="mt-2 mb-3.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">{t("fields.id")}</dt>
        <dd className="m-0 font-mono text-sm wrap-anywhere">{c.id}</dd>
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
        <dd className="m-0 wrap-anywhere">{formatPhone(c.phone)}</dd>
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
        <Muted as="p" tone={message.ok ? "ok" : "destructive"} className="my-4">
          {message.text}
        </Muted>
      )}

      <div>
        <Title level={3} className="mb-1.5">
          {t("notesTitle")}
        </Title>
        <Textarea
          value={notes}
          maxLength={MAX_NOTES}
          placeholder={t("notesPlaceholder")}
          onChange={(e) => setNotes(e.target.value)}
          aria-label={t("ariaNotes")}
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <Muted>
            {notes.length}/{MAX_NOTES}
          </Muted>
          <Button variant="secondary" onClick={() => save("notes")} disabled={!notesChanged || saving === "notes"}>
            {saving === "notes" ? t("actions.saving") : t("actions.saveNotes")}
          </Button>
        </div>
      </div>

      <Title level={3} className="mt-4 mb-1.5">
        {t("appointmentsTitle")}
      </Title>
      {c.appointments.length === 0 ? (
        <Muted as="p">{t("noAppointments")}</Muted>
      ) : (
        <ul className="list-disc pl-5 leading-relaxed">
          {c.appointments.map((a) => (
            <li key={a.startsAt + a.status} className={cn(a.status === "cancelled" && "text-muted-foreground line-through")}>
              {label(a)}
              {a.status === "cancelled" && (
                <Badge variant="secondary" className="ml-2 font-normal text-muted-foreground">
                  {t("cancelled")}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3.5 flex flex-wrap justify-end gap-2 max-md:[&>*]:flex-1 max-md:[&_button]:w-full">
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
