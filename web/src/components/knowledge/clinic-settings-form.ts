import { z } from "zod";
import type { ClinicSettings } from "../../api";

// Formulário da aba Clínica: o schema, os valores iniciais e nada de React (os testes ficam em clinic-settings-form.test.ts).
// Nome da assistente vazio quer dizer nenhum: o servidor recebe "" e não usa nome.

export const clinicSettingsSchema = z.object({
  name: z.string().trim().min(1, "Enter the clinic name.").max(120, "Use up to 120 characters."),
  assistantName: z.string().trim().max(60, "Use up to 60 characters."),
  kind: z.string().trim().min(1, "Enter the type of clinic.").max(80, "Use up to 80 characters."),
  language: z.enum(["en", "pt"]),
});

export type ClinicSettingsFormValues = z.infer<typeof clinicSettingsSchema>;

export function clinicSettingsDefaults(settings: ClinicSettings): ClinicSettingsFormValues {
  return { name: settings.name, assistantName: settings.assistantName ?? "", kind: settings.kind, language: settings.language };
}
