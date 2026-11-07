// Guardas do fake da Evolution API: só roda em desenvolvimento local e só aceita a chave certa.
import { timingSafeEqual } from "node:crypto";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Recusa iniciar se a URL não for local ou se o ambiente for de produção. */
export function assertLocalDevHost(evolutionApiUrl: string | undefined, nodeEnv: string | undefined): void {
  if (nodeEnv === "production") throw new Error("fake-evolution não roda com NODE_ENV=production");
  if (!evolutionApiUrl) throw new Error("EVOLUTION_API_URL não definido (rode com --env-file=.env)");
  const host = new URL(evolutionApiUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`EVOLUTION_API_URL aponta para ${host}; o fake só roda em localhost, 127.0.0.1 ou [::1]`);
  }
}

/** Compara o header apikey com a chave configurada, em tempo constante. */
export function isAuthorized(received: string | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
