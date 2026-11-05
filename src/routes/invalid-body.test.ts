import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { invalidBody } from "./invalid-body.js";

/** Responde com o helper e devolve o corpo, sem subir o Fastify inteiro. */
function answer(error: z.ZodError) {
  let status = 0;
  let body: unknown;
  const reply = {
    code(code: number) {
      status = code;
      return this;
    },
    send(payload: unknown) {
      body = payload;
      return this;
    },
  };
  invalidBody(reply as never, error);
  return { status, body };
}

test("invalidBody answers 400 invalid_body with plain messages per field", () => {
  const schema = z.object({
    data: z.object({
      facts: z.array(z.object({ value: z.string().min(1), label: z.string().max(3) })),
      email: z.email(),
      count: z.number(),
    }),
  });
  const result = schema.safeParse({ data: { facts: [{ value: "", label: "Preço" }], email: "x", count: "1" } });
  assert.equal(result.success, false);
  const { status, body } = answer(result.error!);
  assert.equal(status, 400);
  assert.deepEqual(body, {
    error: "invalid_body",
    message: "Some fields need attention.",
    fields: [
      { path: "data.facts.0.value", message: "This field is required" },
      { path: "data.facts.0.label", message: "This value is too long" },
      { path: "data.email", message: "This value has the wrong format" },
      { path: "data.count", message: "This value is not valid" },
    ],
  });
});
