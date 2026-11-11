/** +55 11 99999-9999 para números do Brasil; + e os dígitos nos outros casos. */
export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    const cut = rest.length - 4;
    return `+55 ${ddd} ${rest.slice(0, cut)}-${rest.slice(cut)}`;
  }
  return `+${d}`;
}

/** Formatadores de dia e hora no fuso da clínica (agenda, agendamento e clientes). */
export type ClinicFormats = ReturnType<typeof clinicFormats>;
export function clinicFormats(timeZone: string | undefined, locale = "en-US") {
  return {
    day: new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric" }),
    time: new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }),
  };
}
