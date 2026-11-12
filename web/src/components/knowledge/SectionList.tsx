import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Clock, Hospital, Info, Plus, Sparkles, Tag, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteSection, type KnowledgeKind, type KnowledgeRow, type TreatmentRow } from "../../api";
import { FIELD_LABELS } from "@server/modules/knowledge/texts";
import { isBookable } from "@server/modules/knowledge/types";
import { knowledgeKeys } from "../../queries";
import { formatMinutes } from "../duration";
import { reasonTextOf, serverReason } from "./server-reason";
import { KIND_ADD_KEY, KIND_GROUP_KEY, KIND_LABEL_KEY } from "./kinds";
import type { SectionTarget } from "./SectionDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Muted } from "../Muted";
import { Notice } from "../Notice";
import { Title } from "../Title";

const NEW_TARGETS: SectionTarget[] = [{ kind: "treatment" }, { kind: "info" }];

// Ordem dos blocos na lista; cada bloco aparece só se tiver seções.
const GROUP_ORDER: KnowledgeKind[] = ["clinic", "treatment", "info"];

// Ícone e cor de cada tipo: a cor só reforça, o tipo também está escrito no título do bloco.
const KIND_ICON: Record<KnowledgeKind, LucideIcon> = { clinic: Hospital, treatment: Sparkles, info: Info };
const KIND_TONE: Record<KnowledgeKind, string> = {
  clinic: "bg-ok-bg text-ok",
  treatment: "bg-accent text-accent-foreground",
  info: "bg-info-bg text-info",
};

// Rótulos de duração e preço nas duas línguas: a seção guarda o texto da brochura na língua em que foi escrito.
const DURATION_LABELS = new Set<string>([FIELD_LABELS.pt.duration, FIELD_LABELS.en.duration]);
const PRICE_LABELS = new Set<string>([FIELD_LABELS.pt.price, FIELD_LABELS.en.price]);

/** Botão "Adicionar" com o menu dos tipos que o painel cria. */
export function AddSectionButtons({ onAdd }: { onAdd: (target: SectionTarget) => void }) {
  const { t } = useTranslation("knowledge");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <Plus />
          {t("add.menu")}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {NEW_TARGETS.map((target) => (
          <DropdownMenuItem key={target.kind} onSelect={() => onAdd(target)}>
            {t(KIND_ADD_KEY[target.kind])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Lista das seções, em blocos por tipo, na ordem em que foram criadas: a linha abre a edição; excluir pede confirmação. */
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
    <div className="grid gap-6">
      {!hasClinic && <ClinicHint onAdd={onAdd} />}
      {sections.length === 0 ? (
        <EmptyState onAdd={onAdd} />
      ) : (
        <TooltipProvider>
          {GROUP_ORDER.map((kind) => {
            const rows = sections.filter((section) => section.kind === kind);
            if (rows.length === 0) return null;
            return (
              <section key={kind} aria-labelledby={`knowledge-group-${kind}`} className="grid gap-1 border-t border-border pt-5 first:border-t-0 first:pt-0">
                <h3 id={`knowledge-group-${kind}`} className="px-2 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {t(KIND_GROUP_KEY[kind])}
                </h3>
                <ul className="grid gap-0.5">
                  {rows.map((section) => (
                    <SectionRow key={section.key} section={section} onEdit={onEdit} onDelete={() => setPendingDelete(section)} />
                  ))}
                </ul>
              </section>
            );
          })}
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

/** Uma linha: o botão cobre a linha inteira (editar); o lixo fica por cima e é o único outro controle. */
function SectionRow({ section, onEdit, onDelete }: { section: KnowledgeRow; onEdit: (section: KnowledgeRow) => void; onDelete: () => void }) {
  const { t } = useTranslation("knowledge");
  const Icon = KIND_ICON[section.kind];
  const subtitle = subtitleOf(section);
  const meta = section.kind === "treatment" ? treatmentMeta(section) : null;

  return (
    <li className="group relative flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring">
      <button
        type="button"
        aria-label={t("list.editLabel", { title: section.title })}
        onClick={() => onEdit(section)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none before:absolute before:inset-0 before:rounded-lg"
      >
        <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${KIND_TONE[section.kind]}`} aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold break-words text-balance">{section.title}</span>
            {section.kind === "treatment" && !isBookable(section) && (
              <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn">{t("list.notBookable")}</span>
            )}
          </span>
          {subtitle && <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>}
        </span>
        {meta && (meta.duration || meta.price) && (
          <span className="flex max-w-[8rem] shrink-0 flex-col items-end gap-0.5 text-right text-sm tnum">
            {meta.duration && (
              <span className="inline-flex max-w-full items-center gap-1 text-muted-foreground">
                <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{meta.duration}</span>
              </span>
            )}
            {meta.price && (
              <span className="inline-flex max-w-full items-center gap-1 font-medium">
                <Tag className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{meta.price}</span>
              </span>
            )}
          </span>
        )}
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="destructive-ghost"
            size="icon-sm"
            className="relative z-10"
            aria-label={t("list.deleteLabel", { title: section.title })}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("list.delete")}</TooltipContent>
      </Tooltip>
    </li>
  );
}

/** Linha de apoio: a frase do tratamento, ou a primeira linha da seção de informações e do endereço. */
function subtitleOf(section: KnowledgeRow): string | null {
  if (section.kind === "treatment") return section.tagline;
  if (section.kind === "info") return section.data.lines[0] ?? null;
  return section.data.address[0] ?? null;
}

/** Duração e preço do tratamento, como a seção os guarda. Sem fato de duração, vale o tempo bloqueado na agenda. */
function treatmentMeta(section: TreatmentRow) {
  const durationFact = section.data.facts.find((fact) => DURATION_LABELS.has(fact.label))?.value;
  const minutes = section.data.appointmentMinutes;
  return {
    duration: durationFact ?? (minutes ? formatMinutes(minutes) : null),
    price: section.data.facts.find((fact) => PRICE_LABELS.has(fact.label))?.value ?? null,
  };
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

/** Estado vazio: convite para começar, sem ilustração. */
function EmptyState({ onAdd }: { onAdd: (target: SectionTarget) => void }) {
  const { t } = useTranslation("knowledge");
  return (
    <div className="grid justify-items-start gap-4 rounded-xl border border-dashed border-border p-5 sm:p-6">
      <span className="grid size-11 place-items-center rounded-full bg-ok-bg text-ok" aria-hidden="true">
        <Sparkles className="size-5" />
      </span>
      <div className="grid gap-1">
        <p className="m-0 font-semibold text-balance">{t("list.emptyTitle")}</p>
        <Muted as="p">{t("list.empty")}</Muted>
      </div>
      <AddSectionButtons onAdd={onAdd} />
    </div>
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
