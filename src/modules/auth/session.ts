import { createHash, timingSafeEqual } from "node:crypto";
import { sign, verifySigned } from "../../config/crypto.js";

export const SESSION_COOKIE = "sf_session";
export const SESSION_TTL_S = 12 * 60 * 60;
const SESSION_VALUE = "operator";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Compara as senhas pelo SHA-256, em tempo constante e sem depender do tamanho. */
export function checkPassword(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

export function createSessionToken(): string {
  return sign(SESSION_VALUE, SESSION_TTL_S);
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  try {
    return verifySigned(token) === SESSION_VALUE;
  } catch {
    return false;
  }
}

export function cookieOptions(publicUrl: string) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    secure: publicUrl.startsWith("https"),
    maxAge: SESSION_TTL_S,
  };
}
