import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { Controller, FormProvider, useForm, useFormContext } from "react-hook-form";
import { saveClinicSettings, type ClinicSettings } from "../../api";
import { clinicSettingsKeys, clinicSettingsQuery } from "../../queries";
import { clinicSettingsDefaults, clinicSettingsSchema, type ClinicSettingsFormValues } from "./clinic-settings-form";
import { FormSection, TextField } from "./FormParts";
import { reasonLines } from "./server-reason";
import { Muted } from "../Muted";
import { Notice } from "../Notice";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LANGUAGES: { value: "en" | "pt"; label: string }[] = [
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
];

/** Aba Clínica: nome, nome da assistente, tipo da clínica e língua da assistente. */
export function ClinicSettingsPanel() {
  const query = useQuery(clinicSettingsQuery());
  if (query.isError) return <Notice role="alert">Could not load the clinic settings. Please try again.</Notice>;
  if (!query.data) return <Muted as="p">Loading…</Muted>;
  return <ClinicSettingsForm settings={query.data} />;
}

/** Língua da assistente: um Select ligado ao formulário. Muda a assistente e os rótulos, não o texto da brochura. */
function LanguageField() {
  const id = useId();
  const descriptionId = `${id}-description`;
  const { control } = useFormContext<ClinicSettingsFormValues>();
  return (
    <Controller
      name="language"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.error ? true : undefined} className="min-w-0">
          <FieldLabel htmlFor={id}>Assistant language</FieldLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id={id} aria-describedby={descriptionId} aria-invalid={fieldState.error ? true : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((language) => (
                <SelectItem key={language.value} value={language.value}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription id={descriptionId}>
            Changing the language changes the assistant and the labels, not the text you wrote in the brochure.
          </FieldDescription>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function ClinicSettingsForm({ settings }: { settings: ClinicSettings }) {
  const queryClient = useQueryClient();
  const form = useForm<ClinicSettingsFormValues>({
    resolver: zodResolver(clinicSettingsSchema),
    defaultValues: clinicSettingsDefaults(settings),
  });
  const save = useMutation({
    mutationFn: saveClinicSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clinicSettingsKeys.all }),
  });

  return (
    <FormProvider {...form}>
      <form className="grid gap-6" onSubmit={form.handleSubmit((input) => save.mutate(input))}>
        <FormSection title="Clinic">
          <FieldGroup className="gap-6">
            <TextField name="name" label="Clinic name" description="The name patients hear, for example: Sorriso Pleno." />
            <TextField
              name="assistantName"
              label="Assistant name"
              description="Optional. The name the assistant uses when it introduces itself, for example: Ana. Leave it empty for no name."
            />
            <TextField
              name="kind"
              label="Type of clinic"
              description="How the assistant describes the clinic to the model, in the clinic's language, for example: clínica odontológica."
            />
            <LanguageField />
          </FieldGroup>
        </FormSection>
        {save.isSuccess && (
          <Notice tone="ok" role="status">
            Saved. The assistant uses the new settings from the next message.
          </Notice>
        )}
        {save.isError && (
          <Notice role="alert">
            {reasonLines(save.error, "Could not save the clinic settings. Please try again.").map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Notice>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
