import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSection, updateSection, type InfoRow, type KnowledgeRow, type SectionInput, type TreatmentRow } from "../../api";
import { knowledgeKeys } from "../../queries";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "../Notice";
import { Title } from "../Title";
import { InfoForm } from "./InfoForm";
import { KIND_NOUN } from "./kinds";
import { TreatmentForm } from "./TreatmentForm";

/** O que o diálogo edita: uma seção existente, ou uma nova do tipo indicado. */
export type SectionTarget = { kind: "treatment"; section?: TreatmentRow } | { kind: "info"; section?: InfoRow };

export function targetFor(section: KnowledgeRow): SectionTarget {
  return section.kind === "treatment" ? { kind: "treatment", section } : { kind: "info", section };
}

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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {target && (
          <>
            <DialogTitle asChild>
              <Title level={3}>{`${target.section ? "Edit" : "Add"} ${KIND_NOUN[target.kind]}`}</Title>
            </DialogTitle>
            {target.kind === "treatment" ? (
              <TreatmentForm
                section={target.section}
                saving={save.isPending}
                onCancel={handleClose}
                onSubmit={(input) => save.mutate({ target, input })}
              />
            ) : (
              <InfoForm
                section={target.section}
                saving={save.isPending}
                onCancel={handleClose}
                onSubmit={(input) => save.mutate({ target, input })}
              />
            )}
          </>
        )}
        {save.isError && <Notice role="alert">Could not save the section. Please try again.</Notice>}
      </DialogContent>
    </Dialog>
  );
}
