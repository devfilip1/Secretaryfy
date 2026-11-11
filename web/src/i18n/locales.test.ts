import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");

/** Achata o JSON em chaves com ponto (nav.short.chats) e confere que cada valor é texto não vazio. */
function flatten(node: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (typeof node === "string") {
    assert.ok(node.trim() !== "", `valor vazio em ${prefix}`);
    out.set(prefix, node);
    return out;
  }
  assert.ok(node !== null && typeof node === "object" && !Array.isArray(node), `${prefix} não é texto nem objeto`);
  for (const [key, child] of Object.entries(node)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

function jsonFiles(language: string): string[] {
  return readdirSync(join(LOCALES_DIR, language))
    .filter((file) => file.endsWith(".json"))
    .sort();
}

test("cada arquivo de en existe em pt, e vice-versa", () => {
  assert.deepEqual(jsonFiles("pt"), jsonFiles("en"));
});

test("en e pt têm exatamente as mesmas chaves em cada arquivo, sem valor vazio", () => {
  for (const file of jsonFiles("en")) {
    const enPath = join(LOCALES_DIR, "en", file);
    const ptPath = join(LOCALES_DIR, "pt", file);
    assert.ok(existsSync(ptPath), `pt/${file} falta`);
    const en = flatten(JSON.parse(readFileSync(enPath, "utf8")));
    const pt = flatten(JSON.parse(readFileSync(ptPath, "utf8")));
    assert.deepEqual([...pt.keys()].sort(), [...en.keys()].sort(), `chaves diferentes em ${file}`);
  }
});
