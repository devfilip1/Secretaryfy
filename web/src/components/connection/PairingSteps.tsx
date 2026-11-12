import { Trans, useTranslation } from "react-i18next";

/** Número do passo em um círculo suave; os números usam tnum para alinhar. */
function StepNumber({ n }: { n: number }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-primary tnum">
      {n}
    </span>
  );
}

/** Passos para parear o WhatsApp pelo celular, numerados e com texto alinhado à esquerda. */
export function PairingSteps() {
  const { t } = useTranslation("connection");
  return (
    <ol className="grid gap-2.5 text-left leading-relaxed">
      <li className="flex items-start gap-3">
        <StepNumber n={1} />
        <span>{t("connect.step1")}</span>
      </li>
      <li className="flex items-start gap-3">
        <StepNumber n={2} />
        <span>
          <Trans i18nKey="connect.step2" ns="connection" components={{ strong: <strong /> }} />
        </span>
      </li>
      <li className="flex items-start gap-3">
        <StepNumber n={3} />
        <span>{t("connect.step3")}</span>
      </li>
    </ol>
  );
}
