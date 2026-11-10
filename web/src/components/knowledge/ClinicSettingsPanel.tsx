import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Controller, FormProvider, useForm, useFormContext } from "react-hook-form";
import { publishKnowledge, saveClinicSettings, type ClinicSettings } from "../../api";
import { clinicSettingsKeys, clinicSettingsQuery, knowledgeKeys } from "../../queries";
import { clinicSettingsDefaults, clinicSettingsSchema, type ClinicSettingsFormValues } from "./clinic-settings-form";
import { FormSection, TextField } from "./FormParts";
import { LanguageChangeDialog } from "./LanguageChangeDialog";
import { publishErrorMessage } from "./PublishBar";
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
            The language the assistant uses with patients and in the brochure labels. Write the brochure text in this same language: changing this setting does not translate it.
          </FieldDescription>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

/**
 * Depois de trocar a língua: os textos automáticos da brochura mudaram e só a publicação leva
 * o texto novo ao assistente. Usa o mesmo POST e a mesma chave de status da aba Conhecimento.
 */
function PublishLanguageOffer({ language }: { language: ClinicSettings["language"] }) {
  const queryClient = useQueryClient();
  const publish = useMutation({
    mutationFn: publishKnowledge,
    onSuccess: (next) => queryClient.setQueryData(knowledgeKeys.status(), next),
  });
  const languageLabel = LANGUAGES.find((option) => option.value === language)?.label ?? language;
  return (
    <>
      {publish.isSuccess ? (
        <p>Published. The assistant answers from the new text.</p>
      ) : (
        <>
          <p>
            The brochure&apos;s automatic texts are now in {languageLabel}. Publish so the assistant&apos;s brochure uses them.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => publish.mutate()} disabled={publish.isPending}>
              {publish.isPending ? "Publishing…" : "Publish now"}
            </Button>
          </div>
        </>
      )}
      {publish.isError && (
        <Notice role="alert">{publishErrorMessage(publish.error)}</Notice>
      )}
    </>
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
  // Valores com língua trocada, esperando a confirmação do diálogo antes do PUT.
  const [pendingLanguageSave, setPendingLanguageSave] = useState<ClinicSettingsFormValues | null>(null);
  const pendingLanguageLabel = LANGUAGES.find((language) => language.value === pendingLanguageSave?.language)?.label;
  // Língua nova do último salvamento que a trocou (null quando não trocou): oferece publicar a brochura.
  const [changedLanguage, setChangedLanguage] = useState<ClinicSettings["language"] | null>(null);

  // A língua de antes é a das configurações carregadas quando o formulário foi enviado.
  function saveInput(input: ClinicSettingsFormValues) {
    const previousLanguage = settings.language;
    setChangedLanguage(null);
    save.mutate(input, {
      onSuccess: () => setChangedLanguage(input.language !== previousLanguage ? input.language : null),
    });
  }

  return (
    <FormProvider {...form}>
      <form
        className="grid gap-6"
        onSubmit={form.handleSubmit((input) => {
          if (input.language === settings.language) saveInput(input);
          else setPendingLanguageSave(input);
        })}
      >
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
            <p>Saved. The assistant uses the new settings from the next message.</p>
            {changedLanguage && <PublishLanguageOffer language={changedLanguage} />}
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
      {pendingLanguageSave && pendingLanguageLabel && (
        <LanguageChangeDialog
          languageLabel={pendingLanguageLabel}
          onCancel={() => setPendingLanguageSave(null)}
          onConfirm={() => {
            saveInput(pendingLanguageSave);
            setPendingLanguageSave(null);
          }}
        />
      )}
    </FormProvider>
  );
}
