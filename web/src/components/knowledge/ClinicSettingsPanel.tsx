import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Controller, FormProvider, useForm, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { publishKnowledge, saveClinicSettings, type ClinicSettings } from "../../api";
import { clinicSettingsKeys, clinicSettingsQuery, knowledgeKeys } from "../../queries";
import { clinicSettingsDefaults, clinicSettingsSchema, translateErrors, type ClinicSettingsFormValues } from "./clinic-settings-form";
import { FormSection, TextField } from "./FormParts";
import { LanguageChangeDialog } from "./LanguageChangeDialog";
import { publishErrorMessage } from "./PublishBar";
import { reasonLines, reasonTextOf } from "./server-reason";
import { Muted } from "../Muted";
import { Notice } from "../Notice";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Nome de cada língua na própria língua: não se traduz
const LANGUAGES: { value: "en" | "pt"; label: string }[] = [
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
];

/** Aba Clínica: nome, nome da assistente, tipo da clínica e língua da assistente. */
export function ClinicSettingsPanel() {
  const { t } = useTranslation("clinic");
  const query = useQuery(clinicSettingsQuery());
  if (query.isError) return <Notice role="alert">{t("loadError")}</Notice>;
  if (!query.data) return <Muted as="p">{t("loading")}</Muted>;
  return <ClinicSettingsForm settings={query.data} />;
}

/** Língua da assistente: um Select ligado ao formulário. Muda a assistente e os rótulos, não o texto da brochura. */
function LanguageField() {
  const { t } = useTranslation("clinic");
  const id = useId();
  const descriptionId = `${id}-description`;
  const { control } = useFormContext<ClinicSettingsFormValues>();
  return (
    <Controller
      name="language"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.error ? true : undefined} className="min-w-0">
          <FieldLabel htmlFor={id}>{t("assistantLanguage.label")}</FieldLabel>
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
          <FieldDescription id={descriptionId}>{t("assistantLanguage.help")}</FieldDescription>
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
  const { t } = useTranslation("clinic");
  const queryClient = useQueryClient();
  const publish = useMutation({
    mutationFn: publishKnowledge,
    onSuccess: (next) => queryClient.setQueryData(knowledgeKeys.status(), next),
  });
  const languageLabel = LANGUAGES.find((option) => option.value === language)?.label ?? language;
  return (
    <>
      {publish.isSuccess ? (
        <p>{t("publishOffer.published")}</p>
      ) : (
        <>
          <p>{t("publishOffer.body", { language: languageLabel })}</p>
          <div className="flex justify-end">
            <Button onClick={() => publish.mutate()} disabled={publish.isPending}>
              {publish.isPending ? t("publishOffer.publishing") : t("publishOffer.publish")}
            </Button>
          </div>
        </>
      )}
      {publish.isError && <Notice role="alert">{publishErrorMessage(publish.error, t)}</Notice>}
    </>
  );
}

function ClinicSettingsForm({ settings }: { settings: ClinicSettings }) {
  const { t } = useTranslation("clinic");
  // Textos do namespace knowledge para as linhas de erro do servidor, no idioma do painel.
  const { t: tKnowledge } = useTranslation("knowledge");
  const queryClient = useQueryClient();
  // Validação pelo schema (códigos); os códigos viram texto do idioma do painel antes de chegar aos campos.
  const validate = zodResolver(clinicSettingsSchema);
  const form = useForm<ClinicSettingsFormValues>({
    resolver: async (values, context, options) => {
      const result = await validate(values, context, options);
      // Mesmo resultado do zodResolver, só com os textos: o tipo do resolver não muda
      return { ...result, errors: translateErrors(result.errors, (code) => t(`validation.${code}`)) } as typeof result;
    },
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
        <FormSection title={t("section")}>
          <FieldGroup className="gap-6">
            <TextField name="name" label={t("name")} description={t("nameHelp")} />
            <TextField name="assistantName" label={t("assistantName")} description={t("assistantNameHelp")} />
            <TextField name="kind" label={t("kind")} description={t("kindHelp")} />
            <LanguageField />
          </FieldGroup>
        </FormSection>
        {save.isSuccess && (
          <Notice tone="ok" role="status">
            <p>{t("saved")}</p>
            {changedLanguage && <PublishLanguageOffer language={changedLanguage} />}
          </Notice>
        )}
        {save.isError && (
          <Notice role="alert">
            {reasonLines(save.error, t("saveError"), reasonTextOf(tKnowledge)).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Notice>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t("saving") : t("save")}
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
