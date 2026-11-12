import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteSection, type KnowledgeRow } from "../../api";
import { isBookable } from "@server/modules/knowledge/types";
import { knowledgeKeys } from "../../queries";
import { reasonTextOf, serverReason } from "./server-reason";
import { KIND_ADD_KEY, KIND_LABEL_KEY } from "./kinds";
import type { SectionTarget } from "./SectionDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Muted } from "../Muted";
import { Notice } from "../Notice";
import { Title } from "../Title";

const NEW_TARGETS: SectionTarget[] = [{ kind: "treatment" }, { kind: "info" }];

/** Os botões de criar: um por tipo de seção. A clínica não entra aqui: a seção nasce da importação. */
export function AddSectionButtons({ onAdd }: { onAdd: (target: SectionTarget) => void }) {
  const { t } = useTranslation("knowledge");
  return (
    <div className="flex flex-wrap gap-2">
      {NEW_TARGETS.map((target) => (
        <Button key={target.kind} variant="secondary" onClick={() => onAdd(target)}>
          <Plus />
          {t(KIND_ADD_KEY[target.kind])}
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
  const { t } = useTranslation("knowledge");
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
  const hasClinic = sections.some((section) => section.kind === "clinic");

  return (
    <div className="grid gap-5">
      {!hasClinic && <ClinicHint onAdd={onAdd} />}
      {sections.length === 0 ? (
        <div className="grid justify-items-start gap-4 py-6">
          <Muted as="p">{t("list.empty")}</Muted>
          <AddSectionButtons onAdd={onAdd} />
        </div>
      ) : (
        <TooltipProvider>
          <ul className="divide-y divide-border border-y border-border">
            {sections.map((section) => (
              <li key={section.key} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold break-words text-balance">{section.title}</span>
                    <Badge variant="secondary">{t(KIND_LABEL_KEY[section.kind])}</Badge>
                    {section.kind === "treatment" && !isBookable(section) && (
                      <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn">{t("list.notBookable")}</span>
                    )}
                  </div>
                  {section.tagline && <Muted as="p" className="break-words">{section.tagline}</Muted>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="secondary" size="sm" onClick={() => onEdit(section)}>
                    <Pencil />
                    {t("list.edit")}
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="destructive-ghost"
                        size="icon-sm"
                        aria-label={t("list.deleteLabel", { title: section.title })}
                        onClick={() => setPendingDelete(section)}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("list.delete")}</TooltipContent>
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
      )}
    </div>
  );
}

/** Aviso sem clínica: o assistente não tem endereço nem contato até a seção existir. */
function ClinicHint({ onAdd }: { onAdd: (target: SectionTarget) => void }) {
  const { t } = useTranslation("knowledge");
  return (
    <Notice tone="plain" layout="box">
      <Muted>{t("clinicHint")}</Muted>
      <Button variant="secondary" size="sm" onClick={() => onAdd({ kind: "clinic" })}>
        <Plus />
        {t("add.clinic")}
      </Button>
    </Notice>
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
  const { t } = useTranslation("knowledge");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle asChild>
            <Title level={3}>{t("deleteDialog.title", { title: section.title })}</Title>
          </DialogTitle>
          <DialogDescription>{t("deleteDialog.description")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <DialogBody>
            <Notice role="alert">{serverReason(error, t("deleteDialog.error"), reasonTextOf(t))}</Notice>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} autoFocus>
            {t("deleteDialog.keep")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? t("deleteDialog.deleting") : t("deleteDialog.confirm")}
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
