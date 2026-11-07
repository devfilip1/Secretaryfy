import { Title } from "../Title";
import { Muted } from "../Muted";

// O texto de ajuda fica aqui como dados: cada bloco tem um título e, conforme o caso, parágrafos, passos,
// uma lista ou pares "você preenche -> o assistente lê". Os exemplos vêm da brochura da Limpeza Dental.

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
    title: "What you fill in and what the assistant reads",
    paragraphs: [
      "Each field you fill in becomes a sentence the assistant can say. The words before the text, such as Como funciona, are already filled in for you. This is the Limpeza Dental treatment, as the brochure has it.",
    ],
    pairs: [
      { fill: "Title and short description", reads: ["Limpeza Dental - O Primeiro Passo para um Sorriso Saudável"] },
      { fill: "Who it is for", reads: ["Ideal para quem quer", "Sensação imediata de boca limpa", "Hálito mais fresco"] },
      { fill: "How it works", reads: ["Como funciona: Remoção de placa e tártaro com ultrassom, seguida de polimento."] },
      {
        fill: "Duration and Price",
        reads: ["Duração: 30 a 50 minutos   |   Preço: R$ 40 a R$ 85 (valor final definido na avaliação)"],
      },
      { fill: "Result", reads: ["Resultado: Imediato, já na primeira sessão"] },
      { fill: "Recovery time", reads: ["Recuperação: 3 a 7 dias"] },
    ],
  },
  {
    title: "What each text field means",
    list: [
      "How it works: how the treatment is done and which materials it uses.",
      "Result: what the patient gets and how long it lasts.",
      "Recovery time: how long healing takes afterwards.",
    ],
  },
  {
    title: "Duration, price and more details",
    paragraphs: [
      "Duration and Price have one field each. When the price is a range, such as R$ 40 to R$ 85, turn on Final value depends on the assessment, so the assistant says the final value is set at the assessment.",
      "Other facts, such as a monthly fee, go in More details. Give each one a name and a value.",
    ],
  },
  {
    title: "Info sections",
    paragraphs: [
      "Address, hours, contact, why choose us and a closing call to action are free lines. Write one line for each thing you want the assistant to be able to repeat.",
    ],
  },
  {
    title: "Clinic details",
    paragraphs: [
      "The clinic block holds the address, phone and email the assistant gives when patients ask where to come and how to reach you. There is one clinic block, created from the brochure when the knowledge is imported. You can edit it here.",
      "The opening hours are not written here. They come from the booking rules in the Calendar page, so they are written once and stay in step with the bookings. Change them there.",
    ],
    list: [
      "Intro: the opening lines, one per row. Optional.",
      "Address: one line per row, for example: Avenida Atlântica, 125, Sala 204. At least one line is needed.",
      "Phone and email: optional.",
      "Closing text: the last lines the assistant says, such as a call to book. Optional.",
    ],
  },
  {
    title: "Clinic name and assistant",
    paragraphs: [
      "Save on the Clinic tab sends these three fields to the server. The assistant uses a new name from the next message.",
    ],
    list: [
      "Clinic name: the name patients hear, for example: Sorriso Pleno.",
      "Assistant name: the name the assistant uses when it introduces itself, for example: Ana. Leave it empty for no name.",
      "Type of clinic: how the assistant describes the clinic to the model, in the clinic's language, for example: clínica odontológica.",
      "The language is set when the server starts, so the panel only shows it.",
    ],
  },
  {
    title: "Booking",    paragraphs: [
      "Each treatment has the switch Patients can book this treatment, on by default. When it is on, the assistant offers the treatment in the booking list. Turn it off for treatments that are only information: the assistant can still explain it, but does not offer it for booking. Treatments that are off show Not bookable in the list.",
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
