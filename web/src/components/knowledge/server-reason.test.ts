import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../../api";
import { fieldLine, humanizePath, reasonLines, serverReason } from "./server-reason";

describe("humanizePath", () => {
  it("drops the root data, numbers rows from 1 and splits camelCase", () => {
    assert.equal(humanizePath("data.facts.0.value"), "Facts, row 1, value");
    assert.equal(humanizePath("data.facts.1.value"), "Facts, row 2, value");
    assert.equal(humanizePath("data.treatmentName"), "Treatment name");
  });

  it("returns an empty text when the path is only data", () => {
    assert.equal(humanizePath("data"), "");
    assert.equal(humanizePath(""), "");
  });
});

describe("fieldLine", () => {
  it("joins the humanized path and the message in lower case", () => {
    assert.equal(fieldLine({ path: "data.facts.1.value", message: "This field is required" }), "Facts, row 2, value: this field is required");
  });

  it("keeps the bare message when there is no path", () => {
    assert.equal(fieldLine({ path: "", message: "This value is not valid" }), "This value is not valid");
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
      "Facts, row 1, value: this field is required",
    ]);
  });

  it("uses the fallback for a non-API error and ignores malformed fields", () => {
    assert.deepEqual(reasonLines(new Error("boom"), "Fallback"), ["Fallback"]);
    const err = new ApiError(400, "invalid_body", { message: "Some fields need attention.", fields: [{ path: 3 }, null] });
    assert.deepEqual(reasonLines(err, "Fallback"), ["Some fields need attention."]);
  });

  it("serverReason keeps the first line", () => {
    const err = new ApiError(400, "invalid_body", { message: "Some fields need attention.", fields: [] });
    assert.equal(serverReason(err, "Fallback"), "Some fields need attention.");
    assert.equal(serverReason(new ApiError(500, "boom", {}), "Fallback"), "Fallback");
  });
});
