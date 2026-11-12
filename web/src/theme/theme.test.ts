import assert from "node:assert/strict";
import { test } from "node:test";
import type { KeyValueStorage } from "../i18n/language";
import { applyTheme, isThemeChoice, readStoredTheme, writeStoredTheme, type ThemeRoot } from "./theme";

/** Storage em memória: devolve `value` na leitura e guarda o que foi gravado em `saved`. */
function memory(value: string | null = null): KeyValueStorage & { saved: string[] } {
  const saved: string[] = [];
  return {
    getItem: () => value,
    setItem: (_key, written) => {
      saved.push(written);
    },
    saved,
  };
}

/** Storage bloqueado: toda operação lança, como no navegador com o armazenamento bloqueado. */
const blocked: KeyValueStorage = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

/** Raiz falsa: guarda o atributo data-theme em um Map. */
function fakeRoot(initial?: string): ThemeRoot & { attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  if (initial !== undefined) attrs.set("data-theme", initial);
  return {
    attrs,
    setAttribute: (name, value) => {
      attrs.set(name, value);
    },
    removeAttribute: (name) => {
      attrs.delete(name);
    },
  };
}

test("só system, light e dark são escolhas válidas", () => {
  assert.equal(isThemeChoice("system"), true);
  assert.equal(isThemeChoice("light"), true);
  assert.equal(isThemeChoice("dark"), true);
  assert.equal(isThemeChoice("DARK"), false);
  assert.equal(isThemeChoice(null), false);
});

test("leitura aceita só escolhas válidas e ignora o resto", () => {
  assert.equal(readStoredTheme(memory("dark")), "dark");
  assert.equal(readStoredTheme(memory("light")), "light");
  assert.equal(readStoredTheme(memory("purple")), undefined);
  assert.equal(readStoredTheme(memory(null)), undefined);
});

test("gravação grava a escolha", () => {
  const storage = memory();
  writeStoredTheme("system", storage);
  assert.deepEqual(storage.saved, ["system"]);
});

test("storage bloqueado não lança na leitura nem na gravação", () => {
  assert.equal(readStoredTheme(blocked), undefined);
  assert.doesNotThrow(() => writeStoredTheme("dark", blocked));
});

test("light e dark gravam data-theme na raiz", () => {
  const light = fakeRoot();
  applyTheme("light", light);
  assert.equal(light.attrs.get("data-theme"), "light");

  const dark = fakeRoot();
  applyTheme("dark", dark);
  assert.equal(dark.attrs.get("data-theme"), "dark");
});

test("system remove data-theme, mesmo que já estivesse definido", () => {
  const root = fakeRoot("dark");
  applyTheme("system", root);
  assert.equal(root.attrs.has("data-theme"), false);
});
