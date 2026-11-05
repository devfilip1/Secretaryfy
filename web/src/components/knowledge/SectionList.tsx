import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteSection, type KnowledgeRow } from "../../api";
import { knowledgeKeys } from "../../queries";
import { serverReason } from "./server-reason";
import { KIND_LABEL, KIND_NOUN } from "./kinds";
import type { SectionTarget } from "./SectionDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Muted } from "../Muted";
import { Notice } from "../Notice";
import { Title } from "../Title";

const NEW_TARGETS: SectionTarget[] = [{ kind: "treatment" }, { kind: "info" }];

/** Os botões de criar: um por tipo de seção. */
export function AddSectionButtons({ onAdd }: { onAdd: (target: SectionTarget) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {NEW_TARGETS.map((target) => (
        <Button key={target.kind} variant="secondary" onClick={() => onAdd(target)}>
          <Plus />
          {`Add ${KIND_NOUN[target.kind]}`}
        </Button>
      ))}
    </div>
  );
}

/** Lista das seções na ordem em que foram criadas: editar e excluir (com confirmação). */
export function SectionList({
  sections,
  onEdit,
  onAdd,
}: {
  sections?: KnowledgeRow[];
  onEdit: (section: KnowledgeRow) => void;
  onAdd: (target: SectionTarget) => void;
}) {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<KnowledgeRow | null>(null);
  const remove = useMutation({
    mutationFn: (key: string) => deleteSection(key),
    onSuccess: () => {
      setPendingDelete(null);
      return queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });

  if (!sections) return <SkeletonRows />;
  if (sections.length === 0) {
    return (
      <div className="grid justify-items-start gap-4 py-6">
        <Muted as="p">No sections yet. Start with a treatment, or add a few info lines such as the address and hours.</Muted>
        <AddSectionButtons onAdd={onAdd} />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <ul className="divide-y divide-border border-y border-border">
        {sections.map((section) => (
          <li key={section.key} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
            <div className="min-w-0 flex-1 basis-56">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold break-words text-balance">{section.title}</span>
                <Badge variant="secondary">{KIND_LABEL[section.kind]}</Badge>
              </div>
              {section.tagline && <Muted as="p" className="break-words">{section.tagline}</Muted>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="secondary" onClick={() => onEdit(section)}>
                <Pencil />
                Edit
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive-ghost"
                    size="icon"
                    aria-label={`Delete ${section.title}`}
                    onClick={() => setPendingDelete(section)}
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </div>
          </li>
        ))}
      </ul>
      {pendingDelete && (
        <DeleteDialog
          section={pendingDelete}
          busy={remove.isPending}
          error={remove.isError ? remove.error : null}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => remove.mutate(pendingDelete.key)}
        />
      )}
    </TooltipProvider>
  );
}

function DeleteDialog({
  section,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  section: KnowledgeRow;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogTitle asChild>
          <Title level={3}>{`Delete ${section.title}?`}</Title>
        </DialogTitle>
        <DialogDescription>The assistant stops answering about it after you publish.</DialogDescription>
        {error ? <Notice role="alert">{serverReason(error, "Could not delete the section. Please try again.")}</Notice> : null}
        <DialogFooter className="mt-2">
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Keep
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete section"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkeletonRows() {
  return (
    <div className="grid gap-2 border-t border-border py-3">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-12" />
      ))}
    </div>
  );
}
