import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { knowledgeListQuery } from "../queries";
import { KIND_NOUN } from "../components/knowledge/kinds";
import { PublishBar } from "../components/knowledge/PublishBar";
import { SectionDialog, targetFor, type SectionTarget } from "../components/knowledge/SectionDialog";
import { SectionList } from "../components/knowledge/SectionList";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";

const NEW_TARGETS: SectionTarget[] = [{ kind: "treatment" }, { kind: "info" }];

/** Conhecimento da clínica: as seções que o assistente usa, com publicação no RAG. */
export function KnowledgePage() {
  const list = useQuery(knowledgeListQuery());
  const [target, setTarget] = useState<SectionTarget | null>(null);

  return (
    <Page>
      <div className="w-[min(820px,100%)]">
        <Card as="section" className="w-full">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <Title level={2} className="mb-0.5">
                Knowledge
              </Title>
              <Muted as="p">What the assistant knows about the clinic. Changes reach the assistant after you publish.</Muted>
            </div>
            <PublishBar />
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {NEW_TARGETS.map((newTarget) => (
              <Button key={newTarget.kind} variant="secondary" onClick={() => setTarget(newTarget)}>
                <Plus />
                {`Add ${KIND_NOUN[newTarget.kind]}`}
              </Button>
            ))}
          </div>
          {list.isError ? (
            <Notice role="alert">Could not load the knowledge. Please try again.</Notice>
          ) : (
            <SectionList sections={list.data} onEdit={(section) => setTarget(targetFor(section))} />
          )}
          <SectionDialog target={target} onClose={() => setTarget(null)} />
        </Card>
      </div>
    </Page>
  );
}
