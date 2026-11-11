import type { FieldErrors } from "react-hook-form";
import { z } from "zod";
import type { ClinicSettings } from "../../api";

// Formulário da aba Clínica: o schema, os valores iniciais e nada de React (os testes ficam em clinic-settings-form.test.ts).
// Nome da assistente vazio quer dizer nenhum: o servidor recebe "" e não usa nome.
// As mensagens de validação são códigos (chaves de validation.* em clinic.json): a tela troca pelo texto no idioma do painel.

export type ValidationCode =
  | "nameRequired"
  | "nameTooLong"
  | "assistantNameTooLong"
  | "kindRequired"
  | "kindTooLong"
  | "languageInvalid";

export const clinicSettingsSchema = z.object({
  name: z.string().trim().min(1, "nameRequired").max(120, "nameTooLong"),
  assistantName: z.string().trim().max(60, "assistantNameTooLong"),
  kind: z.string().trim().min(1, "kindRequired").max(80, "kindTooLong"),
  language: z.enum(["en", "pt"], { error: "languageInvalid" }),
});

export type ClinicSettingsFormValues = z.infer<typeof clinicSettingsSchema>;

export function clinicSettingsDefaults(settings: ClinicSettings): ClinicSettingsFormValues {
  return { name: settings.name, assistantName: settings.assistantName ?? "", kind: settings.kind, language: settings.language };
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
