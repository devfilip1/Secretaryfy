import { useTranslation } from "react-i18next";
import { Title } from "../Title";
import { ToothIcon } from "../tooth-icon";

/** Painel de marca da tela de entrar. No celular vira um cabeçalho compacto acima do formulário (sem a frase de apoio). */
export function LoginBrand() {
  const { t } = useTranslation("login");
  return (
    <section className="flex items-center gap-3.5 bg-rail p-4 text-rail-ink md:flex-col md:items-start md:justify-end md:gap-5 md:p-9">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground md:size-12">
        <ToothIcon className="size-5 md:size-6" />
      </span>
      <div className="grid min-w-0 gap-1 md:gap-3">
        <span className="text-sm opacity-80">{t("brandName")}</span>
        <Title level={1} className="text-lg text-white md:text-3xl md:leading-tight">
          {t("brandTitle")}
        </Title>
        <p className="m-0 hidden text-sm opacity-75 md:block">{t("brandText")}</p>
      </div>
    </section>
  );
}
