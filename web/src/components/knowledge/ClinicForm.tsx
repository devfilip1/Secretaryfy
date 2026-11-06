import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import type { ClinicRow, KnowledgeLabels } from "../../api";
import { clinicDefaults, clinicFormSchema, toClinicData, toClinicInput, type ClinicFormValues } from "./form-values";
import { clinicReadLines } from "./read-preview";
import { ItemsField } from "./ItemsField";
import { FormSection, TextField, type SectionFormProps } from "./FormParts";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Muted } from "../Muted";

/** Formulário da clínica: uma seção só, criada pela importação. Os horários vêm da Agenda e são só lidos aqui. */
export function ClinicForm({
  section,
  formId,
  onSubmit,
  labels,
  hours,
}: SectionFormProps<ClinicRow> & { labels: KnowledgeLabels; hours: string[] }) {
  const form = useForm<ClinicFormValues>({
    resolver: zodResolver(clinicFormSchema),
    defaultValues: clinicDefaults(section),
  });
  const values = useWatch({ control: form.control }) as ClinicFormValues;
  const readLines = clinicReadLines(toClinicData(values), labels, hours);

  return (
    <FormProvider {...form}>
      <form id={formId} onSubmit={form.handleSubmit((input) => onSubmit(toClinicInput(input)))}>
        <FieldGroup className="gap-10">
          <FormSection title="Basics">
            <TextField
              name="title"
              label="Title"
              description="The name of this section, for example: Sorriso Pleno - Clinic information."
            />
            <TextField
              name="intro"
              label="Intro"
              multiline
              description="Optional. The opening lines of the brochure, one line per row, for example: Transforme seu sorriso com segurança e rapidez."
            />
          </FormSection>

          <FormSection title="Address">
            <ItemsField
              name="address"
              label="Address"
              description="One line per row, for example: Avenida Atlântica, 125, Sala 204. Press Enter for a new line."
            />
          </FormSection>

          <FormSection title="Contact">
            <TextField name="phone" label="Phone" description="Optional. For example: (21) 3000-0000." />
            <TextField name="email" label="Email" description="Optional. For example: contato@clinica.example." />
          </FormSection>

          <FormSection title="Opening hours">
            <LinesBox lines={hours} empty="No opening hours set yet." />
            <Muted as="p">The hours come from the booking rules, so they are written once and stay in step with bookings.</Muted>
            <div>
              <Button variant="link" className="px-0" asChild>
                <a href="#/calendar">Change the hours in Calendar</a>
              </Button>
            </div>
          </FormSection>

          <FormSection title="Closing text">
            <TextField
              name="closing"
              label="Text"
              multiline
              description="Optional. The last lines the assistant says, one per row, for example: Agende pelo WhatsApp."
            />
          </FormSection>

          <FormSection title="The assistant reads">
            <Muted as="p">These are the lines the assistant can say, in this order.</Muted>
            <LinesBox lines={readLines} empty="Nothing yet. Fill in the address first." />
          </FormSection>
        </FieldGroup>
      </form>
    </FormProvider>
  );
}

/** Linhas numa caixa com borda: os horários e a leitura do assistente. Sem linhas, mostra `empty`. */
function LinesBox({ lines, empty }: { lines: string[]; empty: string }) {
  if (lines.length === 0) return <Muted as="p">{empty}</Muted>;
  return (
    <div className="grid gap-1 rounded-lg border border-border p-4 text-sm break-words text-pretty">
      {lines.map((line, index) => (
        <p key={`${index}-${line}`}>{line}</p>
      ))}
    </div>
  );
}
