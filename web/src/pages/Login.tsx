import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, login } from "../api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CenterPage } from "../components/CenterPage";
import { Field } from "../components/Field";
import { Notice } from "../components/Notice";
import { Title } from "../components/Title";
import { ToothIcon } from "../components/tooth-icon";
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
    <CenterPage>
      <div className="grid w-[min(400px,100%)] gap-4">
        <div className="flex items-center justify-end gap-2">
          <ThemeSelect />
          <PanelLanguage />
        </div>
        <Card as="form" className="grid gap-5" onSubmit={submit}>
          <div className="grid justify-items-center gap-3 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-accent text-primary">
              <ToothIcon className="size-6" />
            </span>
            <Title level={1}>Secretaryfy</Title>
            <p className="m-0 text-muted-foreground">{t("subtitle")}</p>
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
        </Card>
      </div>
    </CenterPage>
  );
}
