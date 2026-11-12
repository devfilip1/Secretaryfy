import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withLanguage } from "./api";

describe("withLanguage", () => {
  it("põe o idioma como query quando o caminho não tem query", () => {
    assert.equal(withLanguage("/api/services", "pt"), "/api/services?language=pt");
    assert.equal(withLanguage("/api/customers", "en"), "/api/customers?language=en");
  });

  it("junta o idioma às queries que já existem com &", () => {
    assert.equal(withLanguage("/api/booking/lookup?phone=5571999999999", "en"), "/api/booking/lookup?phone=5571999999999&language=en");
    assert.equal(withLanguage("/api/appointments?days=7&from=today", "pt"), "/api/appointments?days=7&from=today&language=pt");
  });
});
