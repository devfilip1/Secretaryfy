import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteCustomer, listCustomers, type Customer, type CustomerAppointment } from "../api";
import { formatPhone } from "../format";
import { useFormats } from "../i18n/formats";
import { useInboxEvents } from "../useEvents";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { CustomerDetail } from "../components/customers/CustomerDetail";
import { CUSTOMER_ROW_GRID, CustomerRow } from "../components/customers/CustomerRow";
import { CustomersPagination } from "../components/customers/CustomersPagination";
import { serverErrorKey, type ErrorMessage } from "../components/customers/customer-errors";
import { paginate } from "../components/customers/pagination";
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

/** Cadastro de clientes: quem já confirmou um horário (specs/005). Tabela à esquerda e ficha do cliente selecionado à direita; no celular, a ficha ocupa a tela (specs/006). */
export function CustomersPage() {
  const { t } = useTranslation("customers");
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [timeZone, setTimeZone] = useState<string | undefined>();
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  // Depois da busca; a página é ajustada se a lista encolher (ex.: cliente excluído)
  const pageSlice = paginate(shown, page);
  // Seleção sobrevive à troca de página; some sozinha se o cliente for excluído
  const selected = customers?.find((c) => c.id === selectedId) ?? null;

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
      <div className="grid w-[min(1080px,100%)] gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
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
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            aria-label={t("searchLabel")}
            className="w-[min(280px,100%)] max-md:w-full"
          />
        </div>
        {errorText && <Notice role="alert">{errorText}</Notice>}
        <div className="grid overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className={cn("min-w-0", selected && "max-md:hidden")}>
            {customers.length === 0 || shown.length === 0 ? (
              <p className="py-12 text-center text-pretty text-muted-foreground">
                {customers.length === 0 ? t("empty") : t("noResults", { query })}
              </p>
            ) : (
              <>
                <div
                  className={cn(
                    "hidden gap-x-3 border-b border-border px-5 py-2.5 text-xs text-muted-foreground md:grid",
                    CUSTOMER_ROW_GRID,
                  )}
                >
                  <span>{t("columns.name")}</span>
                  <span>{t("columns.phone")}</span>
                  <span>{t("columns.next")}</span>
                </div>
                <ul className="divide-y divide-border">
                  {pageSlice.items.map((c) => (
                    <li key={c.id}>
                      <CustomerRow
                        customer={c}
                        next={nextAppointment(c)}
                        label={label}
                        selected={selected?.id === c.id}
                        onSelect={() => setSelectedId(c.id)}
                      />
                    </li>
                  ))}
                </ul>
                {pageSlice.pageCount > 1 && (
                  <div className="border-t border-border px-3 py-3 md:px-5">
                    <CustomersPagination slice={pageSlice} onPageChange={setPage} />
                  </div>
                )}
              </>
            )}
          </div>
          <div className={cn("min-w-0 md:border-l md:border-border", !selected && "hidden md:flex md:items-center md:justify-center")}>
            {selected ? (
              <CustomerDetail
                key={selected.id}
                customer={selected}
                next={nextAppointment(selected)}
                formats={formats}
                label={label}
                onSaved={replace}
                onDelete={() => remove(selected)}
                deleting={deleting === selected.id}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <Muted as="p" className="p-8 text-center">
                {t("pickOne")}
              </Muted>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}
