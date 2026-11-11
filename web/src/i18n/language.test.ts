import assert from "node:assert/strict";
import { test } from "node:test";
import {
  languageFromBrowser,
  readStoredLanguage,
  resolvePanelLanguage,
  writeStoredLanguage,
  type KeyValueStorage,
} from "./language";

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

/** Storage bloqueado: toda operação lança, como no navegador com cookies de terceiros bloqueados. */
const blocked: KeyValueStorage = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

test("a escolha guardada vence a da clínica e a do navegador", () => {
  assert.equal(resolvePanelLanguage({ stored: "en", clinic: "pt", browser: "pt-BR" }), "en");
});

test("sem escolha guardada, vale o idioma da clínica sobre o do navegador", () => {
  assert.equal(resolvePanelLanguage({ clinic: "pt", browser: "en-US" }), "pt");
});

test("sem escolha nem clínica, vale o idioma do navegador", () => {
  assert.equal(resolvePanelLanguage({ browser: "pt-BR" }), "pt");
  assert.equal(resolvePanelLanguage({ browser: "en-US" }), "en");
});

test("valores inválidos são ignorados na ordem", () => {
  assert.equal(resolvePanelLanguage({ stored: "es", clinic: "fr", browser: "pt" }), "pt");
  assert.equal(resolvePanelLanguage({ stored: "PT", clinic: null, browser: "en" }), "en");
});

test("pt-BR e pt viram pt; outros idiomas do navegador viram en", () => {
  assert.equal(languageFromBrowser("pt-BR"), "pt");
  assert.equal(languageFromBrowser("pt"), "pt");
  assert.equal(languageFromBrowser("fr-FR"), "en");
  assert.equal(languageFromBrowser(""), "en");
  assert.equal(languageFromBrowser(undefined), "en");
});

test("leitura do storage aceita só en ou pt", () => {
  assert.equal(readStoredLanguage(memory("pt")), "pt");
  assert.equal(readStoredLanguage(memory("xx")), undefined);
  assert.equal(readStoredLanguage(memory(null)), undefined);
});

test("gravação grava o idioma escolhido", () => {
  const storage = memory();
  writeStoredLanguage("pt", storage);
  assert.deepEqual(storage.saved, ["pt"]);
});

test("storage bloqueado não lança na leitura nem na gravação", () => {
  assert.equal(readStoredLanguage(blocked), undefined);
  assert.doesNotThrow(() => writeStoredLanguage("pt", blocked));
});
