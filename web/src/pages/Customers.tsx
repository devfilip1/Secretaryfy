import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteCustomer, listCustomers, updateCustomer, type Customer, type CustomerAppointment } from "../api";
import { formatDateTime, formatPhone } from "../format";
import { useInboxEvents } from "../useEvents";

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "short" });
const MAX_NOTES = 1000;

/** Próximo horário marcado, se houver. */
function nextAppointment(c: Customer): CustomerAppointment | null {
  const now = Date.now();
  const future = c.appointments.filter((a) => a.status === "booked" && new Date(a.startsAt).getTime() > now);
  return future.at(-1) ?? null; // a lista vem dos mais recentes para os mais antigos
}

function appointmentLabel(a: CustomerAppointment) {
  return `${formatDateTime(a.startsAt)}${a.service ? ` · ${a.service}` : ""}`;
}

/** Cadastro de clientes: quem já confirmou um horário (specs/005), com edição e anotações (specs/006). */
export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    listCustomers()
      .then((r) => {
        setCustomers(r.customers);
        setError(null);
      })
      .catch(() => setError("Could not load the customers."));
  }, []);
  useEffect(load, [load]);

  useInboxEvents((event) => {
    if (event.type === "customers.updated" || event.type === "reconnected") load();
  });

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

  if (!customers) return <main className="page muted">{error ?? "Loading…"}</main>;

  return (
    <main className="page">
      <div className="customers-page">
        <section className="card wide">
          <div className="customers-head">
            <div>
              <h2>Customers</h2>
              <p className="muted small">
                {customers.length === 1 ? "1 customer" : `${customers.length} customers`} · added when they confirm a booking
              </p>
            </div>
            <input
              type="search"
              placeholder="Search by name or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search customers"
            />
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {customers.length === 0 ? (
            <p className="muted empty">No customers yet. Anyone who confirms a booking shows up here.</p>
          ) : shown.length === 0 ? (
            <p className="muted empty">No customers found for “{query}”.</p>
          ) : (
            <ul className="customer-list">
              {shown.map((c) => {
                const next = nextAppointment(c);
                const expanded = open === c.id;
                return (
                  <li key={c.id} className={expanded ? "open" : ""}>
                    <button
                      className="customer-row"
                      onClick={() => setOpen(expanded ? null : c.id)}
                      aria-expanded={expanded}
                    >
                      <span className="customer-name">{c.name}</span>
                      <span className="customer-phone">{formatPhone(c.phone)}</span>
                      <span className="customer-next muted small">
                        {next ? `Next: ${appointmentLabel(next)}` : "No upcoming appointment"}
                      </span>
                      <span className="chevron" aria-hidden="true">
                        {expanded ? "▾" : "▸"}
                      </span>
                      {c.notes && !expanded && <span className="customer-notes-preview">📝 {c.notes}</span>}
                    </button>
                    {expanded && (
                      <CustomerDetail
                        customer={c}
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
        </section>
      </div>
    </main>
  );
}

/** Ficha aberta: nome editável, anotações, conversa e exclusão (specs/006 US2). */
function CustomerDetail({
  customer: c,
  onSaved,
  onDelete,
  deleting,
}: {
  customer: Customer;
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
    <div className="customer-detail">
      <dl>
        <dt>ID</dt>
        <dd className="mono">{c.id}</dd>
        <dt>Name</dt>
        <dd>
          {editing ? (
            <span className="customer-edit">
              <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Customer name" autoFocus />
              <button className="primary" onClick={() => save("name")} disabled={!name.trim() || saving === "name"}>
                {saving === "name" ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setName(c.name);
                }}
              >
                Cancel
              </button>
            </span>
          ) : (
            <span className="customer-edit">
              {c.name}
              <button className="link" onClick={() => setEditing(true)}>
                Edit
              </button>
            </span>
          )}
        </dd>
        <dt>Phone</dt>
        <dd>{formatPhone(c.phone)}</dd>
        <dt>Created</dt>
        <dd>{dateFmt.format(new Date(c.createdAt))}</dd>
        {c.updatedAt !== c.createdAt && (
          <>
            <dt>Updated</dt>
            <dd>{dateFmt.format(new Date(c.updatedAt))}</dd>
          </>
        )}
      </dl>

      {message && <p className={`small ${message.ok ? "ok-text" : "error"}`}>{message.text}</p>}

      <div className="customer-notes">
        <h3>Notes</h3>
        <textarea
          value={notes}
          maxLength={MAX_NOTES}
          placeholder="Only the clinic sees these. E.g. allergic to latex, prefers mornings."
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Notes"
        />
        <div className="row">
          <span className="muted small">
            {notes.length}/{MAX_NOTES}
          </span>
          <button onClick={() => save("notes")} disabled={!notesChanged || saving === "notes"}>
            {saving === "notes" ? "Saving…" : "Save notes"}
          </button>
        </div>
      </div>

      <h3>Appointments</h3>
      {c.appointments.length === 0 ? (
        <p className="muted small">No appointments linked to this record.</p>
      ) : (
        <ul className="customer-appointments">
          {c.appointments.map((a) => (
            <li key={a.startsAt + a.status} className={a.status}>
              {appointmentLabel(a)}
              {a.status === "cancelled" && <span className="tag">cancelled</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        {c.conversationId ? (
          <a className="button-link" href={`#/?c=${c.conversationId}`}>
            View conversation
          </a>
        ) : (
          <button disabled title="No WhatsApp conversation with this customer">
            View conversation
          </button>
        )}
        <button className="danger" onClick={onDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete record"}
        </button>
      </div>
    </div>
  );
}
