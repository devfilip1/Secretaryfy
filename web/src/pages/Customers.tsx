import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, StickyNote } from "lucide-react";
import { deleteCustomer, listCustomers, updateCustomer, type Customer, type CustomerAppointment } from "../api";
import { clinicFormats, formatDate, formatPhone, type ClinicFormats } from "../format";
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

/** Próximo horário marcado, se houver. */
function nextAppointment(c: Customer): CustomerAppointment | null {
  const now = Date.now();
  const future = c.appointments.filter((a) => a.status === "booked" && new Date(a.startsAt).getTime() > now);
  return future.at(-1) ?? null; // a lista vem dos mais recentes para os mais antigos
}

function appointmentLabel(a: CustomerAppointment, formats: ClinicFormats) {
  const when = new Date(a.startsAt);
  return `${formats.day.format(when)}, ${formats.time.format(when)}${a.service ? ` · ${a.service}` : ""}`;
}

/** Cadastro de clientes: quem já confirmou um horário (specs/005), com edição e anotações (specs/006). */
export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [timeZone, setTimeZone] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    listCustomers()
      .then((r) => {
        setCustomers(r.customers);
        setTimeZone(r.timeZone);
        setError(null);
      })
      .catch(() => setError("Could not load the customers."));
  }, []);
  useEffect(load, [load]);

  useInboxEvents((event) => {
    if (event.type === "customers.updated" || event.type === "reconnected") load();
  });

  const formats = useMemo(() => clinicFormats(timeZone), [timeZone]);

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
    const ok = window.confirm(
      `Delete the record for ${c.name} (${formatPhone(c.phone)})?\n\nAppointments already booked stay on Google Calendar. If the customer books again, they are added back.`,
    );
    if (!ok) return;
    setDeleting(c.id);
    try {
      await deleteCustomer(c.id);
      setCustomers((list) => list?.filter((x) => x.id !== c.id) ?? null);
      setError(null);
    } catch {
      setError(`Could not delete the record for ${c.name}. Please try again.`);
    } finally {
      setDeleting(null);
    }
  }

  if (!customers) return <Page className="text-muted-foreground">{error ?? "Loading…"}</Page>;

  return (
    <Page>
      <div className="w-[min(820px,100%)]">
        <Card as="section" className="w-full">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <Title level={2} className="mb-0.5">
                Customers
              </Title>
              <Muted as="p">
                {customers.length === 1 ? "1 customer" : `${customers.length} customers`} · added when they confirm a booking
              </Muted>
            </div>
            <Input
              type="search"
              placeholder="Search by name or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search customers"
              className="w-[min(280px,100%)] max-md:w-full"
            />
          </div>
          {error && <Notice role="alert">{error}</Notice>}
          {customers.length === 0 || shown.length === 0 ? (
            <p className="mt-6 mb-2 text-center text-muted-foreground">
              {customers.length === 0 ? "No customers yet. Anyone who confirms a booking shows up here." : `No customers found for “${query}”.`}
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
                      <Muted className="max-md:col-start-1">{next ? `Next: ${appointmentLabel(next, formats)}` : "No upcoming appointment"}</Muted>
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
                      <CustomerDetail customer={c} formats={formats} onSaved={replace} onDelete={() => remove(c)} deleting={deleting === c.id} />
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
  onSaved,
  onDelete,
  deleting,
}: {
  customer: Customer;
  formats: ClinicFormats;
  onSaved: (c: Customer) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
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
          calendarUpdated
            ? { text: "Name saved.", ok: true }
            : { text: "Name saved, but the calendar event title could not be updated.", ok: false },
        );
      } else {
        setMessage({ text: "Notes saved.", ok: true });
      }
    } catch {
      setMessage({ text: `Could not save the ${field}. Please try again.`, ok: false });
    } finally {
      setSaving(null);
    }
  }

  const notesChanged = notes !== (c.notes ?? "");

  return (
    <div className="px-1.5 pt-1 pb-3.5">
      <dl className="mt-2 mb-3.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">ID</dt>
        <dd className="m-0 font-mono text-sm wrap-anywhere">{c.id}</dd>
        <dt className="text-muted-foreground">Name</dt>
        <dd className="m-0 wrap-anywhere">
          {editing ? (
            <span className="flex flex-wrap items-center gap-2">
              <Input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                aria-label="Customer name"
                autoFocus
                className="min-w-0 flex-1"
              />
              <Button onClick={() => save("name")} disabled={!name.trim() || saving === "name"}>
                {saving === "name" ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setName(c.name);
                }}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              {c.name}
              <Button variant="link" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">Phone</dt>
        <dd className="m-0 wrap-anywhere">{formatPhone(c.phone)}</dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd className="m-0 wrap-anywhere">{formatDate(c.createdAt)}</dd>
        {c.updatedAt !== c.createdAt && (
          <>
            <dt className="text-muted-foreground">Updated</dt>
            <dd className="m-0 wrap-anywhere">{formatDate(c.updatedAt)}</dd>
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
          Notes
        </Title>
        <Textarea
          value={notes}
          maxLength={MAX_NOTES}
          placeholder="Only the clinic sees these. E.g. allergic to latex, prefers mornings."
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Notes"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <Muted>
            {notes.length}/{MAX_NOTES}
          </Muted>
          <Button variant="secondary" onClick={() => save("notes")} disabled={!notesChanged || saving === "notes"}>
            {saving === "notes" ? "Saving…" : "Save notes"}
          </Button>
        </div>
      </div>

      <Title level={3} className="mt-4 mb-1.5">
        Appointments
      </Title>
      {c.appointments.length === 0 ? (
        <Muted as="p">No appointments linked to this record.</Muted>
      ) : (
        <ul className="list-disc pl-5 leading-relaxed">
          {c.appointments.map((a) => (
            <li key={a.startsAt + a.status} className={cn(a.status === "cancelled" && "text-muted-foreground line-through")}>
              {appointmentLabel(a, formats)}
              {a.status === "cancelled" && (
                <Badge variant="secondary" className="ml-2 font-normal text-muted-foreground">
                  cancelled
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3.5 flex flex-wrap justify-end gap-2 max-md:[&>*]:flex-1 max-md:[&_button]:w-full">
        {c.conversationId ? (
          <Button asChild variant="secondary">
            <a href={`#/?c=${c.conversationId}`}>View conversation</a>
          </Button>
        ) : (
          <Button variant="secondary" disabled title="No WhatsApp conversation with this customer">
            View conversation
          </Button>
        )}
        <Button variant="destructive" onClick={onDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete record"}
        </Button>
      </div>
    </div>
  );
}
