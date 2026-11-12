import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { navItemFor, navItemsAt, NAV_ITEMS, viewFromHash } from "./nav";

describe("viewFromHash", () => {
  it("resolve cada hash atual para a sua tela", () => {
    for (const item of NAV_ITEMS) {
      assert.equal(viewFromHash(item.hash), item.view, item.hash);
    }
  });

  it("mantém os hashes antigos funcionando", () => {
    assert.equal(viewFromHash("#/conexao"), "connection");
    assert.equal(viewFromHash("#/agenda"), "calendar");
    assert.equal(viewFromHash("#/clientes"), "customers");
  });

  it("ignora a query string", () => {
    assert.equal(viewFromHash("#/calendar?day=2026-11-11"), "calendar");
    assert.equal(viewFromHash("#/conexao?x=1"), "connection");
  });

  it("cai na caixa de entrada para hash vazio ou desconhecido", () => {
    assert.equal(viewFromHash(""), "inbox");
    assert.equal(viewFromHash("#"), "inbox");
    assert.equal(viewFromHash("#/nao-existe"), "inbox");
    assert.equal(viewFromHash("#/constructor"), "inbox");
  });
});

describe("destinos e posições", () => {
  it("o topo da barra lateral tem conversas, agendamentos, clientes e conhecimento", () => {
    assert.deepEqual(
      navItemsAt("top").map((item) => item.view),
      ["inbox", "appointments", "customers", "knowledge"],
    );
  });

  it("embaixo ficam conexão e agenda", () => {
    assert.deepEqual(
      navItemsAt("bottom").map((item) => item.view),
      ["connection", "calendar"],
    );
  });

  it("cada destino está em exatamente uma posição e a barra lateral mostra todos", () => {
    const shown = [...navItemsAt("top"), ...navItemsAt("bottom")];
    assert.equal(shown.length, NAV_ITEMS.length);
    for (const item of NAV_ITEMS) {
      assert.equal(shown.filter((candidate) => candidate.view === item.view).length, 1, item.view);
    }
  });

  it("a ordem da barra de baixo do celular não muda", () => {
    assert.deepEqual(
      NAV_ITEMS.map((item) => item.view),
      ["inbox", "appointments", "connection", "calendar", "customers", "knowledge"],
    );
  });

  it("navItemFor devolve o destino da tela", () => {
    assert.equal(navItemFor("calendar").labelKey, "nav.calendar");
    assert.equal(navItemFor("knowledge").hash, "#/knowledge");
  });

  it("telas e hashes não se repetem", () => {
    assert.equal(new Set(NAV_ITEMS.map((item) => item.view)).size, NAV_ITEMS.length);
    assert.equal(new Set(NAV_ITEMS.map((item) => item.hash)).size, NAV_ITEMS.length);
  });
});
