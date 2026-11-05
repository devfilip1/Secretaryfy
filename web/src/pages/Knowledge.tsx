import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { knowledgeListQuery } from "../queries";
import { KnowledgeHelp } from "../components/knowledge/KnowledgeHelp";
import { PublishBar } from "../components/knowledge/PublishBar";
import { SectionDialog, targetFor, type SectionTarget } from "../components/knowledge/SectionDialog";
import { AddSectionButtons, SectionList } from "../components/knowledge/SectionList";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";

/** Conhecimento da clínica: as seções que o assistente usa, com publicação no RAG, e a ajuda. */
export function KnowledgePage() {
  const list = useQuery(knowledgeListQuery());
  const [target, setTarget] = useState<SectionTarget | null>(null);
  const hasSections = (list.data?.length ?? 0) > 0;

  return (
    <Page>
      <div className="w-full min-w-0 max-w-4xl">
        <Card as="section" className="w-full min-w-0">
          <Title level={2} className="mb-1">
            Knowledge
          </Title>
          <Muted as="p">What the assistant knows about the clinic. Changes reach the assistant after you publish.</Muted>
          <Tabs defaultValue="sections" className="mt-5">
            <TabsList>
              <TabsTrigger value="sections">Sections</TabsTrigger>
              <TabsTrigger value="help">Help</TabsTrigger>
            </TabsList>
            <TabsContent value="sections" className="grid gap-5 pt-4">
              <PublishBar />
              {hasSections && <AddSectionButtons onAdd={setTarget} />}
              {list.isError ? (
                <Notice role="alert">Could not load the knowledge. Please try again.</Notice>
              ) : (
                <SectionList sections={list.data} onEdit={(section) => setTarget(targetFor(section))} onAdd={setTarget} />
              )}
              <SectionDialog target={target} onClose={() => setTarget(null)} />
            </TabsContent>
            <TabsContent value="help" className="pt-4">
              <KnowledgeHelp />
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </Page>
  );
}
