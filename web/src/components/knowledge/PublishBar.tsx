import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CloudOff, Upload, type LucideIcon } from "lucide-react";
import { ApiError, publishKnowledge, type KnowledgeStatus } from "../../api";
import { knowledgeKeys, knowledgeStatusQuery } from "../../queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "../Notice";

// Ícone e texto junto da cor: o estado não depende só da cor
const STATUS_BADGE: Record<KnowledgeStatus["state"], { variant: "secondary" | "warn"; text: string; icon: LucideIcon }> = {
  upToDate: { variant: "secondary", text: "Up to date", icon: CircleCheck },
  unpublished: { variant: "warn", text: "Unpublished changes", icon: CircleAlert },
  unavailable: { variant: "warn", text: "Assistant offline", icon: CloudOff },
};

function publishErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) return "Publishing is already running. Try again in a moment.";
  if (err instanceof ApiError && err.status === 502) return "The assistant service is not reachable.";
  return "Could not publish. Please try again.";
}

/** Estado da publicação no assistente e o botão para publicar as mudanças. */
export function PublishBar() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery(knowledgeStatusQuery());
  const publish = useMutation({
    mutationFn: publishKnowledge,
    onSuccess: (next) => queryClient.setQueryData(knowledgeKeys.status(), next),
  });
  const badge = status ? STATUS_BADGE[status.state] : null;
  const justPublished = publish.isSuccess && status?.state === "upToDate";

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3">
        {badge && (
          <Badge variant={badge.variant}>
            <badge.icon />
            {badge.text}
          </Badge>
        )}
        <Button onClick={() => publish.mutate()} disabled={status?.state !== "unpublished" || publish.isPending}>
          <Upload />
          {publish.isPending ? "Publishing…" : "Publish"}
        </Button>
      </div>
      {justPublished && (
        <Notice tone="ok" role="status">
          Published. The assistant now answers from the new text.
        </Notice>
      )}
      {publish.isError && <Notice role="alert">{publishErrorMessage(publish.error)}</Notice>}
    </div>
  );
}
