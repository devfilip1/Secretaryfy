import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, publishKnowledge, type KnowledgeStatus } from "../../api";
import { knowledgeKeys, knowledgeStatusQuery } from "../../queries";
import { Button } from "@/components/ui/button";
import { Notice } from "../Notice";

type PublishErrorKey = "publishBar.busy" | "publishBar.unreachable" | "publishBar.failed";

// Ponto colorido e texto junto: o estado não depende só da cor
const STATUS_DOT: Record<KnowledgeStatus["state"], { textKey: "status.upToDate" | "status.unpublished" | "status.unavailable"; dot: string }> = {
  upToDate: { textKey: "status.upToDate", dot: "bg-ok" },
  unpublished: { textKey: "status.unpublished", dot: "bg-warn" },
  unavailable: { textKey: "status.unavailable", dot: "bg-muted-foreground" },
};

/** Texto do erro de publicação. `t` é o da aba Clínica (quem chama passa o seu). */
export function publishErrorMessage(err: unknown, t: (key: PublishErrorKey) => string): string {
  if (err instanceof ApiError && err.status === 409) return t("publishBar.busy");
  if (err instanceof ApiError && err.status === 502) return t("publishBar.unreachable");
  return t("publishBar.failed");
}

/** Barra fina e fixa no topo da aba: estado da publicação no assistente e o botão para publicar. */
export function PublishBar() {
  const { t } = useTranslation("clinic");
  const queryClient = useQueryClient();
  const { data: status } = useQuery(knowledgeStatusQuery());
  const publish = useMutation({
    mutationFn: publishKnowledge,
    onSuccess: (next) => queryClient.setQueryData(knowledgeKeys.status(), next),
  });
  const state = status ? STATUS_DOT[status.state] : null;
  const justPublished = publish.isSuccess && status?.state === "upToDate";

  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {state && (
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <span className={`size-2 shrink-0 rounded-full ${state.dot}`} aria-hidden="true" />
            {t(state.textKey)}
          </span>
        )}
        <Button size="sm" onClick={() => publish.mutate()} disabled={status?.state !== "unpublished" || publish.isPending}>
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
    </>
  );
}
