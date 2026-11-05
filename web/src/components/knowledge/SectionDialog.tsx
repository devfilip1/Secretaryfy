import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSection, updateSection, type InfoRow, type KnowledgeRow, type SectionInput, type TreatmentRow } from "../../api";
import { knowledgeKeys } from "../../queries";
import { serverReason } from "./server-reason";
import { InfoForm } from "./InfoForm";
import { KIND_NOUN } from "./kinds";
import { TreatmentForm } from "./TreatmentForm";
import { Notice } from "../Notice";
import { Title } from "../Title";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

/** O que o diálogo edita: uma seção existente, ou uma nova do tipo indicado. */
export type SectionTarget = { kind: "treatment"; section?: TreatmentRow } | { kind: "info"; section?: InfoRow };

export function targetFor(section: KnowledgeRow): SectionTarget {
  return section.kind === "treatment" ? { kind: "treatment", section } : { kind: "info", section };
}

const FORM_ID = "section-form";

const DESCRIPTION = {
  treatment: "A treatment has a name, facts such as price and duration, and the result patients can expect.",
  info: "Free lines such as address, hours or contact.",
} as const;

/** Diálogo de criar ou editar uma seção; `target` null deixa o diálogo fechado. */
export function SectionDialog({ target, onClose }: { target: SectionTarget | null; onClose: () => void }) {
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
            <DialogTitle asChild>
              <Title level={3}>{`${target.section ? "Edit" : "Add"} ${KIND_NOUN[target.kind]}`}</Title>
            </DialogTitle>
            <DialogDescription>{DESCRIPTION[target.kind]}</DialogDescription>
            {target.kind === "treatment" ? (
              <TreatmentForm
                section={target.section}
                formId={FORM_ID}
                onSubmit={(input) => save.mutate({ target, input })}
              />
            ) : (
              <InfoForm section={target.section} formId={FORM_ID} onSubmit={(input) => save.mutate({ target, input })} />
            )}
            {save.isError && (
              <Notice role="alert" className="whitespace-pre-line">
                {serverReason(save.error, "Could not save the section. Please try again.")}
              </Notice>
            )}
            <DialogFooter className="sticky bottom-0 -mx-5 -mb-5 mt-1 border-t border-border bg-card px-5 py-3">
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
