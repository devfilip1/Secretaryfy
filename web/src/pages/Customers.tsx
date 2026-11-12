import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteCustomer, listCustomers, type Customer, type CustomerAppointment } from "../api";
import { formatPhone } from "../format";
import { useFormats } from "../i18n/formats";
import { useInboxEvents } from "../useEvents";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CustomerDetail } from "../components/customers/CustomerDetail";
import { CustomerRow } from "../components/customers/CustomerRow";
import { serverErrorKey, type ErrorMessage } from "../components/customers/customer-errors";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";

/** Próximo horário marcado, se houver. */
function nextAppointment(c: Customer): CustomerAppointment | null {
  const now = Date.now();
  const future = c.appointments.filter((a) => a.status === "booked" && new Date(a.startsAt).getTime() > now);
  return future.at(-1) ?? null; // a lista vem dos mais recentes para os mais antigos
}

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
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <Title level={2} className="mb-0.5">
                {t("title")}
              </Title>
              <Muted as="p" className="tnum">
                {t("count", { count: customers.length })}
              </Muted>
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
            <p className="py-12 text-center text-pretty text-muted-foreground">
              {customers.length === 0 ? t("empty") : t("noResults", { query })}
            </p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {shown.map((c) => {
                const expanded = open === c.id;
                return (
                  <li key={c.id}>
                    <CustomerRow
                      customer={c}
                      next={nextAppointment(c)}
                      label={label}
                      expanded={expanded}
                      onToggle={() => setOpen(expanded ? null : c.id)}
                    />
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
