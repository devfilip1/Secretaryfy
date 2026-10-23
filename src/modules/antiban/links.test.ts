import assert from "node:assert/strict";
import { test } from "node:test";
import { LINK_PLACEHOLDER, stripLinks } from "./links.js";

test("na primeira resposta todos os links saem", () => {
  const r = stripLinks("See https://x.com/a and www.y.com.", { firstReply: true, allowedDomains: ["x.com"] });
  assert.equal(r.text, `See ${LINK_PLACEHOLDER} and ${LINK_PLACEHOLDER}.`);
  assert.equal(r.removed, 2);
});

test("nas demais, ficam só os domínios da lista (inclusive subdomínios)", () => {
  const r = stripLinks("Book at https://agenda.dentalsafe.com.br/x or bit.ly/abc", {
    firstReply: false,
    allowedDomains: ["dentalsafe.com.br"],
  });
  assert.equal(r.text, `Book at https://agenda.dentalsafe.com.br/x or ${LINK_PLACEHOLDER}`);
  assert.equal(r.removed, 1);
});

test("texto sem link fica igual, e horários ou abreviações não são links", () => {
  const text = "We open at 10.30, e.g. on Mondays. Cost: $1.200.";
  assert.deepEqual(stripLinks(text, { firstReply: true, allowedDomains: [] }), { text, removed: 0 });
});
