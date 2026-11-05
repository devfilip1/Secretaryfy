import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { deleteSection, reorderSections, type KnowledgeRow } from "../../api";
import { knowledgeKeys } from "../../queries";
import { KIND_LABEL } from "./kinds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Muted } from "../Muted";
import { Notice } from "../Notice";
import { Title } from "../Title";

/** Ordem das chaves com a seção de `index` trocada com a da posição `target`. */
function swapped(keys: string[], index: number, target: number): string[] {
  const next = [...keys];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Lista das seções em ordem: mover, editar e excluir (com confirmação). */
export function SectionList({ sections, onEdit }: { sections?: KnowledgeRow[]; onEdit: (section: KnowledgeRow) => void }) {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<KnowledgeRow | null>(null);
  const reorder = useMutation({
    mutationFn: (keys: string[]) => reorderSections(keys),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.all }),
  });
  const remove = useMutation({
    mutationFn: (key: string) => deleteSection(key),
    onSuccess: () => {
      setPendingDelete(null);
      return queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });

  if (!sections) return <SkeletonRows />;
  if (sections.length === 0) {
    return <Muted as="p" className="py-6 text-center">No sections yet. Add a treatment or an info section.</Muted>;
  }

  const keys = sections.map((section) => section.key);
  const busy = reorder.isPending;

  return (
    <>
      {reorder.isError && <Notice role="alert" className="mb-2">Could not change the order. Please try again.</Notice>}
      <ul className="border-t border-border">
        {sections.map((section, index) => (
          <li key={section.key} className="flex items-center gap-2 border-b border-border px-1.5 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold">{section.title}</span>
                <Badge variant="secondary">{KIND_LABEL[section.kind]}</Badge>
              </div>
              {section.tagline && <Muted as="p" className="truncate">{section.tagline}</Muted>}
            </div>
            <MoveButton
              label="Move up"
              icon={ArrowUp}
              disabled={busy || index === 0}
              onClick={() => reorder.mutate(swapped(keys, index, index - 1))}
            />
            <MoveButton
              label="Move down"
              icon={ArrowDown}
              disabled={busy || index === sections.length - 1}
              onClick={() => reorder.mutate(swapped(keys, index, index + 1))}
            />
            <Button variant="secondary" onClick={() => onEdit(section)}>
              Edit
            </Button>
            <Button variant="destructive" onClick={() => setPendingDelete(section)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
      {pendingDelete && (
        <DeleteDialog
          section={pendingDelete}
          busy={remove.isPending}
          failed={remove.isError}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => remove.mutate(pendingDelete.key)}
        />
      )}
    </>
  );
}

function MoveButton({ label, icon: Icon, disabled, onClick }: { label: string; icon: LucideIcon; disabled: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="link" aria-label={label} disabled={disabled} onClick={onClick}>
      <Icon />
    </Button>
  );
}

function DeleteDialog({
  section,
  busy,
  failed,
  onCancel,
  onConfirm,
}: {
  section: KnowledgeRow;
  busy: boolean;
  failed: boolean;
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
      <DialogContent role="alertdialog">
        <DialogTitle asChild>
          <Title level={3}>Delete section?</Title>
        </DialogTitle>
        <DialogDescription>{`"${section.title}" leaves the assistant after you publish.`}</DialogDescription>
        {failed && <Notice role="alert">Could not delete the section. Please try again.</Notice>}
        <DialogFooter className="mt-3.5 flex-row justify-end max-md:flex-wrap">
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
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
