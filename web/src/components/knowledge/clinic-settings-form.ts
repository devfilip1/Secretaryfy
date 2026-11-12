import type { FieldErrors } from "react-hook-form";
import { z } from "zod";
import type { ClinicSettings, ClinicSettingsInput } from "../../api";

// Formulário da aba Clínica: o schema, os valores iniciais e nada de React (os testes ficam em clinic-settings-form.test.ts).
// Nome da assistente vazio quer dizer nenhum: o servidor recebe "" e não usa nome.
// As mensagens de validação são códigos (chaves de validation.* em clinic.json): a tela troca pelo texto no idioma do painel.

export type ValidationCode =
  | "nameRequired"
  | "nameTooLong"
  | "assistantNameTooLong"
  | "kindRequired"
  | "kindTooLong"
  | "languageInvalid"
  | "minutesInvalid";

// Duração de serviço: de 15 a 240 minutos, de 5 em 5. Vazio quer dizer o padrão da agenda.
export const MIN_SERVICE_MINUTES = 15;
export const MAX_SERVICE_MINUTES = 240;
export const SERVICE_MINUTES_STEP = 5;

function isEmptyOrServiceMinutes(value: string): boolean {
  if (value === "") return true;
  if (!/^\d+$/.test(value)) return false;
  const minutes = Number(value);
  return minutes >= MIN_SERVICE_MINUTES && minutes <= MAX_SERVICE_MINUTES && minutes % SERVICE_MINUTES_STEP === 0;
}

// O campo guarda texto (o que o input number devolve); a conversão para número é de toClinicSettingsInput.
const serviceMinutesSchema = z.string().trim().refine(isEmptyOrServiceMinutes, { message: "minutesInvalid" });

export const clinicSettingsSchema = z.object({
  name: z.string().trim().min(1, "nameRequired").max(120, "nameTooLong"),
  assistantName: z.string().trim().max(60, "assistantNameTooLong"),
  kind: z.string().trim().min(1, "kindRequired").max(80, "kindTooLong"),
  language: z.enum(["en", "pt"], { error: "languageInvalid" }),
  offerAssessment: z.boolean(),
  assessmentMinutes: serviceMinutesSchema,
  offerFollowUp: z.boolean(),
  followUpMinutes: serviceMinutesSchema,
});

export type ClinicSettingsFormValues = z.infer<typeof clinicSettingsSchema>;

function minutesText(minutes: number | null): string {
  return minutes === null ? "" : String(minutes);
}

export function clinicSettingsDefaults(settings: ClinicSettings): ClinicSettingsFormValues {
  return {
    name: settings.name,
    assistantName: settings.assistantName ?? "",
    kind: settings.kind,
    language: settings.language,
    offerAssessment: settings.offerAssessment,
    assessmentMinutes: minutesText(settings.assessmentMinutes),
    offerFollowUp: settings.offerFollowUp,
    followUpMinutes: minutesText(settings.followUpMinutes),
  };
}

/** Valores do formulário para o PUT: minutos vazios viram null. Validado antes pelo schema. */
export function toClinicSettingsInput(values: ClinicSettingsFormValues): ClinicSettingsInput {
  return {
    name: values.name,
    assistantName: values.assistantName,
    kind: values.kind,
    language: values.language,
    offerAssessment: values.offerAssessment,
    offerFollowUp: values.offerFollowUp,
    assessmentMinutes: values.assessmentMinutes === "" ? null : Number(values.assessmentMinutes),
    followUpMinutes: values.followUpMinutes === "" ? null : Number(values.followUpMinutes),
  };
}

/** Troca o código de cada erro pelo texto de `translate`. Campo sem erro segue igual. */
export function translateErrors<Errors extends FieldErrors<ClinicSettingsFormValues>>(
  errors: Errors,
  translate: (code: ValidationCode) => string,
): Errors {
  const translated = Object.fromEntries(
    Object.entries(errors).map(([field, error]) => [
      field,
      error?.message ? { ...error, message: translate(error.message as ValidationCode) } : error,
    ]),
  );
  return translated as Errors;
}
