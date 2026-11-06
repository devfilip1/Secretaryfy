import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormProvider, useForm } from "react-hook-form";
import { saveClinicSettings, type ClinicSettings } from "../../api";
import { clinicSettingsKeys, clinicSettingsQuery } from "../../queries";
import { clinicSettingsDefaults, clinicSettingsSchema, type ClinicSettingsFormValues } from "./clinic-settings-form";
import { FormSection, TextField } from "./FormParts";
import { reasonLines } from "./server-reason";
import { Field } from "../Field";
import { Muted } from "../Muted";
import { Notice } from "../Notice";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const LANGUAGE_NAME = { pt: "Português", en: "English" } as const;

/** Aba Clínica: nome, nome da assistente e tipo da clínica. A língua só aparece; o servidor a define ao iniciar. */
export function ClinicSettingsPanel() {
  const query = useQuery(clinicSettingsQuery());
  if (query.isError) return <Notice role="alert">Could not load the clinic settings. Please try again.</Notice>;
  if (!query.data) return <Muted as="p">Loading…</Muted>;
  return <ClinicSettingsForm settings={query.data} />;
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
            <Field>
              Language
              <Input value={LANGUAGE_NAME[settings.language]} readOnly />
            </Field>
            <Muted as="p">The language is set when the server starts.</Muted>
          </FieldGroup>
        </FormSection>
        {save.isSuccess && (
          <Notice tone="ok" role="status">
            Saved. The assistant uses the new name from the next message.
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
