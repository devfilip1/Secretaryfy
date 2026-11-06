import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createSection,
  updateSection,
  type ClinicRow,
  type InfoRow,
  type KnowledgeLabels,
  type KnowledgeRow,
  type SectionInput,
  type TreatmentRow,
} from "../../api";
import { knowledgeKeys } from "../../queries";
import { reasonLines } from "./server-reason";
import { ClinicForm } from "./ClinicForm";
import { InfoForm } from "./InfoForm";
import { KIND_NOUN } from "./kinds";
import { TreatmentForm } from "./TreatmentForm";
import { Notice } from "../Notice";
import { Title } from "../Title";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** O que o diálogo edita: uma seção existente, ou uma nova do tipo indicado. */
export type SectionTarget =
  | { kind: "treatment"; section?: TreatmentRow }
  | { kind: "info"; section?: InfoRow }
  | { kind: "clinic"; section?: ClinicRow };

export function targetFor(section: KnowledgeRow): SectionTarget {
  switch (section.kind) {
    case "treatment":
      return { kind: "treatment", section };
    case "info":
      return { kind: "info", section };
    case "clinic":
      return { kind: "clinic", section };
  }
}

const FORM_ID = "section-form";

const DESCRIPTION = {
  treatment: "A treatment has a name, facts such as price and duration, and the result patients can expect.",
  info: "Free lines such as address, hours or contact.",
  clinic: "The address, phone and email the assistant gives. The opening hours come from the Calendar page.",
} as const;

/** Diálogo de criar ou editar uma seção; `target` null deixa o diálogo fechado. */
export function SectionDialog({
  target,
  labels,
  hours,
  onClose,
}: {
  target: SectionTarget | null;
  labels: KnowledgeLabels;
  hours: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (request: { target: SectionTarget; input: SectionInput }) =>
      request.target.section
        ? updateSection(request.target.section.key, request.input)
        : createSection({ ...request.input, kind: request.target.kind }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
      handleClose();
    },
  });

  function handleClose() {
    save.reset();
    onClose();
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {target && (
          <>
            <DialogHeader>
              <DialogTitle asChild>
                <Title level={3}>{`${target.section ? "Edit" : "Add"} ${KIND_NOUN[target.kind]}`}</Title>
              </DialogTitle>
              <DialogDescription>{DESCRIPTION[target.kind]}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <SectionForm target={target} labels={labels} hours={hours} onSubmit={(input) => save.mutate({ target, input })} />
              {save.isError && (
                <Notice role="alert" className="mt-4">
                  {reasonLines(save.error, "Could not save the section. Please try again.").map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </Notice>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" form={FORM_ID} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** O formulário do tipo da seção: um lugar só para escolher, sem repetir o diálogo em cada tipo. */
function SectionForm({
  target,
  labels,
  hours,
  onSubmit,
}: {
  target: SectionTarget;
  labels: KnowledgeLabels;
  hours: string[];
  onSubmit: (input: SectionInput) => void;
}) {
  switch (target.kind) {
    case "treatment":
      return <TreatmentForm section={target.section} labels={labels} formId={FORM_ID} onSubmit={onSubmit} />;
    case "info":
      return <InfoForm section={target.section} formId={FORM_ID} onSubmit={onSubmit} />;
    case "clinic":
      return <ClinicForm section={target.section} labels={labels} hours={hours} formId={FORM_ID} onSubmit={onSubmit} />;
  }
}
