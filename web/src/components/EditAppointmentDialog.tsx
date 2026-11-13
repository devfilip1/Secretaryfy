import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, bookingDays, bookingSlots, bookingStarts, listServices, updateAppointment, type Appointment, type AppointmentEdit, type BookingStart } from "../api";
import type { useFormats } from "../i18n/formats";
import { useActivePanelLanguage } from "../i18n/usePanelLanguage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DayField, DurationField, StartField, type DayRange } from "./booking-pickers";
import { parseDuration, validateDuration, formatMinutes } from "./duration";
import { Field } from "./Field";
import { Muted } from "./Muted";
import { Notice } from "./Notice";
import { Title } from "./Title";

/** A duração de uma consulta editada: de 15 a 240 minutos, de 5 em 5 (como as configurações da clínica). */
const EDIT_MIN_MINUTES = 15;
const EDIT_MAX_MINUTES = 240;

/** Dia (YYYY-MM-DD) de um horário no fuso da clínica. */
const dayIn = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/**
 * Edição de uma consulta marcada (painel, ADR 0015): horário, duração, tratamento e nome. Começa com os valores atuais;
 * Salvar fica desligado até mudar algo. Sem mensagem ao cliente. Os horários livres contam a própria consulta como livre.
 */
export function EditAppointmentDialog({
  appointment,
  timeZone,
  formats,
  onKeep,
  onSaved,
  onGone,
}: {
  appointment: Appointment;
  timeZone: string;
  formats: ReturnType<typeof useFormats>;
  onKeep: () => void;
  onSaved: (a: Appointment) => void;
  /** A consulta já não pode ser editada (cancelada, passada ou não existe): fecha e a lista recarrega */
  onGone: () => void;
}) {
  const { t } = useTranslation("appointments");
  const language = useActivePanelLanguage();
  const excludeAppointmentId = appointment.id;
  const [services, setServices] = useState<{ name: string; label: string }[] | null>(null);
  // Chave do tratamento: a atual, e a escolhida (vazia se a consulta tem um tratamento que não está no catálogo)
  const [initialService, setInitialService] = useState("");
  const [service, setService] = useState("");
  const [name, setName] = useState(appointment.customerName);
  const [days, setDays] = useState<string[] | null>(null);
  const [range, setRange] = useState<DayRange | null>(null);
  const [status, setStatus] = useState<Record<string, "free" | "full">>({});
  const [day, setDay] = useState(() => dayIn(appointment.startsAt, timeZone));
  const [slots, setSlots] = useState<string[] | null>(null);
  const [starts, setStarts] = useState<BookingStart[] | null>(null);
  const [start, setStart] = useState<string | null>(appointment.startsAt);
  const [duration, setDuration] = useState(formatMinutes(appointment.minutes));
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Duração válida para consultar a agenda (a que o painel vai salvar); vazia ou fora da faixa, usa a do tratamento
  const parsed = parseDuration(duration);
  const askedMinutes = parsed !== null && validateDuration(duration, EDIT_MAX_MINUTES, EDIT_MIN_MINUTES) === null ? parsed : undefined;

  useEffect(() => {
    listServices(language)
      .then((r) => {
        setServices(r.services);
        const key = r.services.find((s) => s.label === appointment.service)?.name ?? "";
        setInitialService(key);
        setService(key);
      })
      .catch(() => setError(t("errors.services")));
  }, [language]);

  // Dias e horários do tratamento escolhido, na duração digitada. A própria consulta conta como livre.
  useEffect(() => {
    if (!service) return;
    let stale = false;
    bookingDays({ service, minutes: askedMinutes, excludeAppointmentId })
      .then((r) => {
        if (stale) return;
        setDays(r.days);
        setRange({ minDate: r.minDate, maxDate: r.maxDate });
        setStatus(r.status);
      })
      .catch(() => {
        if (!stale) setError(t("errors.calendar"));
      });
    return () => {
      stale = true;
    };
  }, [service, askedMinutes, reload]);

  useEffect(() => {
    if (!service || !day) return;
    let stale = false;
    setSlots(null);
    setStarts(null);
    Promise.all([bookingSlots({ date: day, service, minutes: askedMinutes, excludeAppointmentId }), bookingStarts({ date: day, excludeAppointmentId })]).then(
      ([suggested, all]) => {
        if (stale) return;
        setSlots(suggested.slots);
        setStarts(all.starts);
      },
      () => {
        if (!stale) setError(t("errors.calendar"));
      },
    );
    return () => {
      stale = true;
    };
  }, [day, service, askedMinutes, reload]);

  // Tempo livre do início escolhido: o da lista; o próprio horário atual, sem lista, vale a duração que ele já tem
  const chosen = start ? starts?.find((s) => s.start === start) : undefined;
  const freeMinutes = start ? (chosen?.maxMinutes ?? (start === appointment.startsAt ? appointment.minutes : 0)) : 0;
  const maxMinutes = Math.min(freeMinutes, EDIT_MAX_MINUTES);
  const durationError = start ? validateDuration(duration, maxMinutes, EDIT_MIN_MINUTES) : null;

  // O que mudou: só o que mudou vai para o servidor
  const startChanged = start !== null && start !== appointment.startsAt;
  const minutes = askedMinutes !== undefined && askedMinutes !== appointment.minutes ? askedMinutes : undefined;
  const serviceChanged = service !== "" && service !== initialService;
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== "" && trimmedName !== appointment.customerName;
  const changed = startChanged || minutes !== undefined || serviceChanged || nameChanged;
  const canSave = Boolean(services && service && trimmedName && start && !durationError && changed && !busy);

  function pickDay(next: string) {
    setDay(next);
    setStart(null);
  }

  async function save() {
    if (!start) return;
    const body: AppointmentEdit = {};
    if (startChanged) body.start = start;
    if (minutes !== undefined) body.minutes = minutes;
    if (serviceChanged) body.service = service;
    if (nameChanged) body.name = trimmedName;
    setBusy(true);
    setError(null);
    try {
      const { appointment: saved } = await updateAppointment(appointment.id, body, language);
      onSaved(saved);
    } catch (err) {
      setBusy(false);
      const code = err instanceof ApiError ? err.error : "";
      if (code === "not_found" || code === "not_editable") onGone();
      else if (code === "slot_taken") {
        setError(t("errors.slot_taken"));
        setStart(null);
        // O horário e o tempo livre dos outros mudaram: recarrega a agenda do dia
        setReload((n) => n + 1);
      } else if (code === "calendar_unavailable") setError(t("errors.calendar"));
      else if (code === "invalid_body") setError(t("errors.invalid_body"));
      else setError(t("errors.generic"));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onKeep();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle asChild>
            <Title level={3}>{t("edit.title")}</Title>
          </DialogTitle>
          <DialogDescription>{t("edit.description", { name: appointment.customerName })}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div className="grid items-start gap-3 md:grid-cols-2">
            <Field>
              {t("form.name")}
              <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              {t("form.service")}
              <Select value={service} onValueChange={setService}>
                <SelectTrigger>
                  <SelectValue placeholder={services === null ? t("form.loadingServices") : undefined} />
                </SelectTrigger>
                <SelectContent>
                  {services?.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DayField formats={formats} days={days} range={range} status={status} day={day} onPick={pickDay} />
          {day && <StartField formats={formats} timeZone={timeZone} slots={slots} starts={starts} start={start} onPick={setStart} />}
          {start && (
            <DurationField
              formats={formats}
              start={start}
              maxMinutes={maxMinutes}
              minMinutes={EDIT_MIN_MINUTES}
              duration={duration}
              onChange={setDuration}
            />
          )}

          {error && <Notice role="alert">{error}</Notice>}
        </DialogBody>
        <DialogFooter>
          <Muted className="mr-auto">{t("form.noMessage")}</Muted>
          <Button variant="secondary" onClick={onKeep} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {busy ? t("edit.busy") : t("edit.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
