import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CloudOff, Upload, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, publishKnowledge, type KnowledgeStatus } from "../../api";
import { knowledgeKeys, knowledgeStatusQuery } from "../../queries";
import { Button } from "@/components/ui/button";
import { Notice } from "../Notice";

type PublishErrorKey = "publishBar.busy" | "publishBar.unreachable" | "publishBar.failed";

// Pílula com ícone e texto junto da cor: o estado não depende só da cor
const STATUS_PILL: Record<
  KnowledgeStatus["state"],
  { textKey: "status.upToDate" | "status.unpublished" | "status.unavailable"; icon: LucideIcon; tone: string }
> = {
  upToDate: { textKey: "status.upToDate", icon: CircleCheck, tone: "bg-ok-bg text-ok" },
  unpublished: { textKey: "status.unpublished", icon: CircleAlert, tone: "bg-warn-bg text-warn" },
  unavailable: { textKey: "status.unavailable", icon: CloudOff, tone: "bg-warn-bg text-warn" },
};

/** Texto do erro de publicação. `t` é o da aba Clínica (quem chama passa o seu). */
export function publishErrorMessage(err: unknown, t: (key: PublishErrorKey) => string): string {
  if (err instanceof ApiError && err.status === 409) return t("publishBar.busy");
  if (err instanceof ApiError && err.status === 502) return t("publishBar.unreachable");
  return t("publishBar.failed");
}

/** Estado da publicação no assistente e o botão para publicar as mudanças. */
export function PublishBar() {
  const { t } = useTranslation("clinic");
  const queryClient = useQueryClient();
  const { data: status } = useQuery(knowledgeStatusQuery());
  const publish = useMutation({
    mutationFn: publishKnowledge,
    onSuccess: (next) => queryClient.setQueryData(knowledgeKeys.status(), next),
  });
  const pill = status ? STATUS_PILL[status.state] : null;
  const justPublished = publish.isSuccess && status?.state === "upToDate";

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
        {pill && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${pill.tone}`}>
            <pill.icon className="size-4" aria-hidden="true" />
            {t(pill.textKey)}
          </span>
        )}
        <Button onClick={() => publish.mutate()} disabled={status?.state !== "unpublished" || publish.isPending}>
          <Upload />
          {publish.isPending ? t("publishBar.publishing") : t("publishBar.publish")}
        </Button>
      </div>
      {justPublished && (
        <Notice tone="ok" role="status">
          {t("publishBar.published")}
        </Notice>
      )}
      {publish.isError && <Notice role="alert">{publishErrorMessage(publish.error, t)}</Notice>}
    </div>
  );
}
