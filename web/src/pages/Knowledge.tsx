import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { knowledgeListQuery } from "../queries";
import { ClinicSettingsPanel } from "../components/knowledge/ClinicSettingsPanel";
import { KnowledgeHelp } from "../components/knowledge/KnowledgeHelp";
import { PublishBar } from "../components/knowledge/PublishBar";
import { SectionDialog, targetFor, type SectionTarget } from "../components/knowledge/SectionDialog";
import { AddSectionButtons, SectionList } from "../components/knowledge/SectionList";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Muted } from "../components/Muted";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Title } from "../components/Title";

// Gatilho de aba com sublinhado: o ativo ganha a cor de destaque, sem fundo.
const TAB_CLASS = "h-10 flex-none rounded-none px-0 text-base after:bg-primary data-[state=active]:text-foreground";

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
        <header className="grid gap-1 pb-5">
          <Title level={2}>{t("title")}</Title>
          <Muted as="p">{t("subtitle")}</Muted>
        </header>
        <Tabs defaultValue="sections">
          <TabsList variant="line" className="h-auto w-full justify-start gap-6 rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger value="sections" className={TAB_CLASS}>
              {t("tabs.sections")}
            </TabsTrigger>
            <TabsTrigger value="clinic" className={TAB_CLASS}>
              {t("tabs.clinic")}
            </TabsTrigger>
            <TabsTrigger value="help" className={TAB_CLASS}>
              {t("tabs.help")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="sections" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 pt-4">
            <PublishBar />
            {hasSections && (
              <div className="flex justify-end">
                <AddSectionButtons onAdd={setTarget} />
              </div>
            )}
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
      </div>
    </Page>
  );
}
