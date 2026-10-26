import { useState, type FormEvent } from "react";
import { ApiError, login } from "../api";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
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
        setError(`Too many attempts. Try again in ${minutes} min.`);
      } else if (err instanceof ApiError && err.status === 401) {
        setError("Wrong password.");
      } else {
        setError("Could not sign in. Check that the server is running.");
      }
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <form className="card login" onSubmit={submit}>
        <h1>Secretaryfy</h1>
        <p className="muted">WhatsApp panel</p>
        <label>
          Operator password
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={!password || busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
