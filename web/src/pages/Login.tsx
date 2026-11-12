import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, login } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "../components/Field";
import { LoginBrand } from "../components/login/LoginBrand";
import { Notice } from "../components/Notice";
import { Title } from "../components/Title";
import { PanelLanguage } from "../i18n/PanelLanguage";
import { ThemeSelect } from "../theme/ThemeSelect";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation("login");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onLoggedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const minutes = Math.max(1, Math.ceil(Number(err.body.retry_after_s ?? 60) / 60));
        setError(t("errors.tooManyAttempts", { minutes }));
      } else if (err instanceof ApiError && err.status === 401) {
        setError(t("errors.wrongPassword"));
      } else {
        setError(t("errors.unreachable"));
      }
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-full md:grid-cols-2">
      <LoginBrand />
      <div className="relative grid place-items-center p-4 md:p-9">
        <div className="absolute end-4 top-4 flex items-center gap-2">
          <ThemeSelect />
          <PanelLanguage />
        </div>
        <form className="grid w-full max-w-[360px] gap-5 pt-14 md:pt-0" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Title level={2}>{t("title")}</Title>
            <p className="m-0 text-sm text-muted-foreground">{t("hint")}</p>
          </div>
          <Field className="gap-1.5 font-medium">
            {t("password")}
            <Input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <Notice role="alert">{error}</Notice>}
          <Button type="submit" className="w-full" disabled={!password || busy}>
            {busy ? t("signingIn") : t("signIn")}
          </Button>
        </form>
      </div>
    </main>
  );
}
