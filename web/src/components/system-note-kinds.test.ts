import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SYSTEM_NOTE_KINDS } from "./system-note-kinds";

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");

function systemNoteKeys(language: string): Set<string> {
  const inbox = JSON.parse(readFileSync(join(LOCALES_DIR, language, "inbox.json"), "utf8"));
  return new Set(Object.keys(inbox.systemNote ?? {}));
}

test("cada tipo de registro tem uma chave systemNote em en e em pt", () => {
  for (const language of ["en", "pt"]) {
    const keys = systemNoteKeys(language);
    for (const kind of SYSTEM_NOTE_KINDS) assert.ok(keys.has(kind), `${language}: systemNote.${kind} falta`);
  }
});

test("a lista de tipos não repete nenhum tipo", () => {
  assert.equal(new Set(SYSTEM_NOTE_KINDS).size, SYSTEM_NOTE_KINDS.length);
});
