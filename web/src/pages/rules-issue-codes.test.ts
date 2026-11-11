import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { RULES_ISSUE_CODES } from "./rules-issue-codes.js";

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");

function issueKeys(language: string): string[] {
  const calendar = JSON.parse(readFileSync(join(LOCALES_DIR, language, "calendar.json"), "utf8"));
  return Object.keys(calendar.rules.issue).sort();
}

test("cada código de problema das regras tem texto em en e em pt", () => {
  const codes = [...RULES_ISSUE_CODES].sort();
  assert.deepEqual(issueKeys("en"), codes);
  assert.deepEqual(issueKeys("pt"), codes);
});
