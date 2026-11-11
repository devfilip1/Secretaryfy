import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NAV_GROUPS, NAV_ITEMS, navItemsIn, viewFromHash } from "./nav";

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

describe("destinos e grupos", () => {
  it("cada destino pertence a exatamente um grupo", () => {
    for (const item of NAV_ITEMS) {
      assert.equal(NAV_GROUPS.filter((group) => group.id === item.group).length, 1, item.view);
    }
  });

  it("a ordem dos grupos é fixa: atendimento, clínica, sistema", () => {
    assert.deepEqual(
      NAV_GROUPS.map((group) => group.id),
      ["service", "clinic", "system"],
    );
  });

  it("cada grupo tem ao menos um destino e a barra lateral mostra todos", () => {
    const shown = NAV_GROUPS.flatMap((group) => navItemsIn(group.id));
    assert.equal(shown.length, NAV_ITEMS.length);
    for (const group of NAV_GROUPS) assert.ok(navItemsIn(group.id).length > 0, group.id);
  });

  it("telas e hashes não se repetem", () => {
    assert.equal(new Set(NAV_ITEMS.map((item) => item.view)).size, NAV_ITEMS.length);
    assert.equal(new Set(NAV_ITEMS.map((item) => item.hash)).size, NAV_ITEMS.length);
  });
});
