import assert from "node:assert/strict";
import { test } from "node:test";
import { clinicInitials } from "./clinic-initials";

test("usa a primeira letra das duas primeiras palavras", () => {
  assert.equal(clinicInitials("Clínica Dental Safe"), "CD");
  assert.equal(clinicInitials("  sorriso   azul "), "SA");
});

test("uma palavra gera uma letra, em maiúscula", () => {
  assert.equal(clinicInitials("dentalsafe"), "D");
  assert.equal(clinicInitials("ótica"), "Ó");
});

test("sem nome não há iniciais", () => {
  assert.equal(clinicInitials(""), null);
  assert.equal(clinicInitials("   "), null);
  assert.equal(clinicInitials(undefined), null);
  assert.equal(clinicInitials(null), null);
});
