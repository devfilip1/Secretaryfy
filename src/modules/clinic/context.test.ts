import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClinicContext } from "./context.js";

test("lê a identidade da clínica da configuração", () => {
  const clinic = buildClinicContext({ CLINIC_NAME: "Sorriso Pleno", CLINIC_LANGUAGE: "pt", ASSISTANT_NAME: "Ana", CLINIC_KIND: "dental clinic" });
  assert.deepEqual(clinic, { name: "Sorriso Pleno", assistantName: "Ana", language: "pt", kind: "dental clinic" });
});

test("ASSISTANT_NAME vazio vira undefined: a saudação cita só a clínica", () => {
  const clinic = buildClinicContext({ CLINIC_NAME: "DentalSafe", CLINIC_LANGUAGE: "en", ASSISTANT_NAME: "", CLINIC_KIND: "dental clinic" });
  assert.equal(clinic.assistantName, undefined);
});
