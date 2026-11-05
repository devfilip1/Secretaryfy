import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { ApiError, publishKnowledge, type KnowledgeStatus } from "../../api";
import { knowledgeKeys, knowledgeStatusQuery } from "../../queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "../Notice";

const STATUS_BADGE: Record<KnowledgeStatus["state"], { variant: "secondary" | "warn"; text: string }> = {
  upToDate: { variant: "secondary", text: "Up to date" },
  unpublished: { variant: "warn", text: "Unpublished changes" },
  unavailable: { variant: "warn", text: "Assistant offline" },
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

  return (
    <div className="grid justify-items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {status && <Badge variant={STATUS_BADGE[status.state].variant}>{STATUS_BADGE[status.state].text}</Badge>}
        <Button onClick={() => publish.mutate()} disabled={status?.state !== "unpublished" || publish.isPending}>
          <Upload />
          {publish.isPending ? "Publishing…" : "Publish"}
        </Button>
      </div>
      {publish.isError && <Notice role="alert">{publishErrorMessage(publish.error)}</Notice>}
    </div>
  );
}
