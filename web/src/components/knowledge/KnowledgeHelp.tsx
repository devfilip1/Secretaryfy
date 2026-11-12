import { useTranslation } from "react-i18next";
import { Title } from "../Title";
import { Muted } from "../Muted";

// Os exemplos (nomes e frases da brochura) vêm de help.fill.examples no namespace knowledge, no idioma do painel.

interface HelpPair {
  fill: string;
  reads: string[];
}

interface HelpBlock {
  title: string;
  paragraphs?: string[];
  steps?: string[];
  list?: string[];
  pairs?: HelpPair[];
}

/** Ajuda escrita para a dona ou o dono da clínica: o que a página faz e como preencher uma seção. */
export function KnowledgeHelp() {
  const { t } = useTranslation("knowledge");
  const blocks: HelpBlock[] = [
    {
      title: t("help.page.title"),
      paragraphs: [t("help.page.p1")],
      steps: [t("help.page.s1"), t("help.page.s2"), t("help.page.s3"), t("help.page.s4")],
    },
    {
      title: t("help.fill.title"),
      paragraphs: [t("help.fill.p1")],
      pairs: [
        { fill: t("help.fill.f1"), reads: [t("help.fill.examples.f1")] },
        { fill: t("help.fill.f2"), reads: [t("help.fill.examples.f2Title"), t("help.fill.examples.f2a"), t("help.fill.examples.f2b")] },
        { fill: t("help.fill.f3"), reads: [t("help.fill.examples.f3")] },
        { fill: t("help.fill.f4"), reads: [t("help.fill.examples.f4")] },
        { fill: t("help.fill.f5"), reads: [t("help.fill.examples.f5")] },
        { fill: t("help.fill.f6"), reads: [t("help.fill.examples.f6")] },
      ],
    },
    {
      title: t("help.texts.title"),
      list: [t("help.texts.l1"), t("help.texts.l2"), t("help.texts.l3")],
    },
    {
      title: t("help.duration.title"),
      paragraphs: [t("help.duration.p1"), t("help.duration.p2")],
    },
    {
      title: t("help.info.title"),
      paragraphs: [t("help.info.p1")],
    },
    {
      title: t("help.clinic.title"),
      paragraphs: [t("help.clinic.p1"), t("help.clinic.p2")],
      list: [t("help.clinic.l1"), t("help.clinic.l2"), t("help.clinic.l3"), t("help.clinic.l4")],
    },
    {
      title: t("help.clinicName.title"),
      paragraphs: [t("help.clinicName.p1")],
      list: [t("help.clinicName.l1"), t("help.clinicName.l2"), t("help.clinicName.l3"), t("help.clinicName.l4")],
    },
    {
      title: t("help.booking.title"),
      paragraphs: [t("help.booking.p1")],
    },
    {
      title: t("help.tips.title"),
      list: [t("help.tips.l1"), t("help.tips.l2"), t("help.tips.l3"), t("help.tips.l4")],
    },
  ];

  return (
    <div className="grid gap-8">
      {blocks.map((block) => (
        <section key={block.title} className="grid gap-3 border-t border-border pt-6 first:border-t-0 first:pt-0">
          <Title level={3}>{block.title}</Title>
          {block.paragraphs?.map((text) => (
            <Muted as="p" key={text} className="text-base leading-relaxed">
              {text}
            </Muted>
          ))}
          {block.steps && (
            <ol className="grid list-decimal gap-2 pl-5 text-base">
              {block.steps.map((step) => (
                <li key={step} className="text-pretty">
                  {step}
                </li>
              ))}
            </ol>
          )}
          {block.list && (
            <ul className="grid list-disc gap-2 pl-5 text-base">
              {block.list.map((item) => (
                <li key={item} className="text-pretty">
                  {item}
                </li>
              ))}
            </ul>
          )}
          {block.pairs && (
            <dl className="grid gap-x-4 gap-y-3 rounded-lg bg-muted p-4 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
              {block.pairs.map((pair) => (
                <div key={pair.fill} className="contents">
                  <dt className="font-semibold">{pair.fill}</dt>
                  <dd className="grid gap-1 text-pretty break-words">
                    {pair.reads.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}
