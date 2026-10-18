import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

const key = Buffer.from(env.APP_SECRET, "base64");

/** Criptografa com AES-256-GCM. Formato: iv.tag.ciphertext (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Assina um valor (ex.: id do usuário) para usar no `state` do OAuth. Expira em `ttlSeconds`. */
export function sign(value: string, ttlSeconds = 600): string {
  const body = `${value}:${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return Buffer.from(`${body}:${mac}`).toString("base64url");
}

export function verifySigned(token: string): string | null {
  const [value, exp, mac] = Buffer.from(token, "base64url").toString().split(":");
  if (!value || !exp || !mac) return null;
  const expected = createHmac("sha256", key).update(`${value}:${exp}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return value;
}
