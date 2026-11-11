import { Trans, useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { CenterPage } from "../components/CenterPage";
import { Title } from "../components/Title";

export function Disabled() {
  const { t } = useTranslation();
  return (
    <CenterPage>
      <Card className="w-[min(420px,100%)]">
        <Title level={1} className="mb-1">
          {t("disabled.title")}
        </Title>
        <p className="my-4">
          <Trans i18nKey="disabled.body" components={{ code: <code /> }} />
        </p>
      </Card>
    </CenterPage>
  );
}
