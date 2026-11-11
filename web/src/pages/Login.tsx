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
import { PanelLanguage } from "../i18n/PanelLanguage";

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
      <Card as="form" className="flex w-[min(420px,100%)] flex-col gap-3.5" onSubmit={submit}>
        <PanelLanguage className="self-end" />
        <Title level={1} className="mb-1">
          Secretaryfy
        </Title>
        <p className="text-muted-foreground">{t("subtitle")}</p>
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
        <Button type="submit" disabled={!password || busy}>
          {busy ? t("signingIn") : t("signIn")}
        </Button>
      </Card>
    </CenterPage>
  );
}
