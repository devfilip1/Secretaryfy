import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../../api";
import { fieldLine, humanizePath, reasonLines, reasonTextOf, serverReason, type ReasonText } from "./server-reason";

// Textos em português, como o painel passa (reasonTextOf usa o namespace knowledge; aqui um par fixo).
const PT: ReasonText = {
  code: (code) => (code === "invalid_body" ? "Alguns campos precisam de atenção." : undefined),
  row: (row) => `linha ${row}`,
  field: (label, message) => `${label}: ${message}`,
};

describe("humanizePath", () => {
  it("drops the root data, numbers rows from 1 and splits camelCase", () => {
    assert.equal(humanizePath("data.facts.0.value"), "Facts, row 1, value");
    assert.equal(humanizePath("data.facts.1.value"), "Facts, row 2, value");
    assert.equal(humanizePath("data.treatmentName"), "Treatment name");
  });

  it("uses the row text of the panel language", () => {
    assert.equal(humanizePath("data.facts.1.value", PT), "Facts, linha 2, value");
  });

  it("returns an empty text when the path is only data", () => {
    assert.equal(humanizePath("data"), "");
    assert.equal(humanizePath(""), "");
  });
});

describe("fieldLine", () => {
  it("joins the humanized path and the message", () => {
    assert.equal(fieldLine({ path: "data.facts.1.value", message: "This field is required" }), "Facts, row 2, value: This field is required");
  });

  it("keeps the bare message when there is no path", () => {
    assert.equal(fieldLine({ path: "", message: "This value is not valid" }), "This value is not valid");
  });

  it("uses the panel text when given", () => {
    assert.equal(fieldLine({ path: "data.facts.0.value", message: "Obrigatório" }, PT), "Facts, linha 1, value: Obrigatório");
  });
});

describe("reasonLines", () => {
  it("returns the server message and one line per field", () => {
    const err = new ApiError(400, "invalid_body", {
      message: "Some fields need attention.",
      fields: [{ path: "data.facts.0.value", message: "This field is required" }],
    });
    assert.deepEqual(reasonLines(err, "Fallback"), [
      "Some fields need attention.",
      "Facts, row 1, value: This field is required",
    ]);
  });

  it("uses the translated text for a known error code", () => {
    const err = new ApiError(400, "invalid_body", { message: "Some fields need attention.", fields: [] });
    assert.deepEqual(reasonLines(err, "Fallback", PT), ["Alguns campos precisam de atenção."]);
  });

  it("uses the fallback for a non-API error and ignores malformed fields", () => {
    assert.deepEqual(reasonLines(new Error("boom"), "Fallback"), ["Fallback"]);
    const err = new ApiError(400, "other", { message: "Some fields need attention.", fields: [{ path: 3 }, null] });
    assert.deepEqual(reasonLines(err, "Fallback"), ["Some fields need attention."]);
  });

  it("serverReason keeps the first line", () => {
    const err = new ApiError(400, "invalid_body", { message: "Some fields need attention.", fields: [] });
    assert.equal(serverReason(err, "Fallback"), "Some fields need attention.");
    assert.equal(serverReason(new ApiError(500, "boom", {}), "Fallback"), "Fallback");
  });
});

describe("reasonTextOf", () => {
  it("maps the no_bookable_service code to its knowledge text, and leaves other codes to the server", () => {
    const text = reasonTextOf(((key: string) => `t:${key}`) as never);
    assert.equal(text.code("no_bookable_service"), "t:errors.no_bookable_service");
    assert.equal(text.code("clinic_section_required"), "t:errors.clinic_section_required");
    assert.equal(text.code("unknown_code"), undefined);
  });
});
