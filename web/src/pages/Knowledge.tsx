import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { knowledgeListQuery } from "../queries";
import { ClinicSettingsPanel } from "../components/knowledge/ClinicSettingsPanel";
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
  const { t } = useTranslation("knowledge");
  const list = useQuery(knowledgeListQuery());
  const [target, setTarget] = useState<SectionTarget | null>(null);
  const sections = list.data?.sections;
  const hasSections = (sections?.length ?? 0) > 0;

  return (
    <Page>
      <div className="w-full min-w-0 max-w-4xl">
        <Card as="section" className="w-full min-w-0">
          <Title level={2} className="mb-1">
            {t("title")}
          </Title>
          <Muted as="p">{t("subtitle")}</Muted>
          <Tabs defaultValue="sections" className="mt-5">
            <TabsList>
              <TabsTrigger value="sections">{t("tabs.sections")}</TabsTrigger>
              <TabsTrigger value="clinic">{t("tabs.clinic")}</TabsTrigger>
              <TabsTrigger value="help">{t("tabs.help")}</TabsTrigger>
            </TabsList>
            <TabsContent value="sections" className="grid gap-5 pt-4">
              <PublishBar />
              {hasSections && <AddSectionButtons onAdd={setTarget} />}
              {list.isError ? (
                <Notice role="alert">{t("loadError")}</Notice>
              ) : (
                <SectionList sections={sections} onEdit={(section) => setTarget(targetFor(section))} onAdd={setTarget} />
              )}
              {list.data && <SectionDialog target={target} labels={list.data.labels} hours={list.data.hours} onClose={() => setTarget(null)} />}
            </TabsContent>
            <TabsContent value="clinic" className="pt-4">
              <ClinicSettingsPanel />
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
