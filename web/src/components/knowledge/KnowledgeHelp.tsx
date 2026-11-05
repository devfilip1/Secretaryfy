import { Title } from "../Title";
import { Muted } from "../Muted";

// O texto de ajuda fica aqui como dados: cada bloco tem um título e, conforme o caso, parágrafos, passos,
// uma lista ou o exemplo (Limpeza Dental). Os valores do exemplo vêm da brochura da clínica.

interface HelpBlock {
  title: string;
  paragraphs?: string[];
  steps?: string[];
  list?: string[];
  example?: { label: string; value: string }[];
}

const EXAMPLE_TREATMENT: { label: string; value: string }[] = [
  { label: "Title", value: "Limpeza Dental" },
  { label: "Tagline", value: "O Primeiro Passo para um Sorriso Saudável" },
  { label: "Ideal for", value: "Heading Ideal para quem quer. Items: Sensação imediata de boca limpa; Hálito mais fresco" },
  { label: "How it works", value: "Label Como funciona. Value: Remoção de placa e tártaro com ultrassom, seguida de polimento" },
  { label: "Facts", value: "Duração: 30 a 50 minutos. Preço: R$ 40 a R$ 85, one row each" },
  { label: "Result", value: "Resultado: Imediato, já na primeira sessão" },
];

const HELP_BLOCKS: HelpBlock[] = [
  {
    title: "What this page is",
    paragraphs: [
      "This page holds what the assistant knows about the clinic. The assistant answers patients only from this text, so it cannot answer about anything you have not written here.",
    ],
    steps: [
      "Choose Add treatment or Add info section.",
      "Fill in the fields. Each group has a heading, and an example sits under each field.",
      "Press Save. The section appears in the list, but the assistant does not use it yet.",
      "When your changes are ready, press Publish. Only then does the assistant answer from the new text.",
    ],
  },
  {
    title: "How a treatment is built, with an example",
    paragraphs: ["This is the Limpeza Dental section, filled in as the brochure has it."],
    example: EXAMPLE_TREATMENT,
  },
  {
    title: "Title",
    paragraphs: [
      "The title names the subject of the section. The assistant uses it to tell treatments apart, so write the name patients say. Put one treatment in each section.",
    ],
  },
  {
    title: "Tagline",
    paragraphs: ["The tagline is optional. It is shown after the title, in a shorter line."],
  },
  {
    title: "Labels and values",
    paragraphs: [
      "Write each label exactly as patients should read it, in the clinic's language. The value is the text that goes under it. Keep the wording of your brochure.",
    ],
  },
  {
    title: "Facts",
    paragraphs: [
      "Put numbers here, such as duration and price, one per row. A row with a price range, such as R$ 40 to R$ 85, needs the switch Final value depends on the assessment turned on, so the assistant says the final value is set at the assessment.",
    ],
  },
  {
    title: "Info sections",
    paragraphs: [
      "Address, hours, contact, why choose us and a closing call to action are free lines. Write one line for each thing you want the assistant to be able to repeat.",
    ],
  },
  {
    title: "Tips",
    list: [
      "Do not invent information. The assistant can only repeat what you write here.",
      "Keep one subject per section.",
      "Check every number and price before you publish.",
      "Nothing reaches the assistant until you press Publish.",
    ],
  },
];

/** Ajuda escrita para a dona ou o dono da clínica: o que a página faz e como preencher uma seção. */
export function KnowledgeHelp() {
  return (
    <div className="grid gap-8">
      {HELP_BLOCKS.map((block) => (
        <section key={block.title} className="grid gap-3">
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
          {block.example && (
            <dl className="grid gap-x-4 gap-y-2 rounded-lg bg-muted p-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
              {block.example.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="font-semibold">{row.label}</dt>
                  <dd className="text-pretty break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}
