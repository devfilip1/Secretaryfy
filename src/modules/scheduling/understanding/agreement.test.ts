import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgreementReader, type Agreement } from "./agreement.js";

type Body = { messages: { role: string; content: string }[]; format: object };

/** Ollama falso: guarda o corpo recebido e devolve `reply` (ou falha, se for uma função que lança) */
function fakeOllama(reply: unknown | (() => never)) {
  const bodies: Body[] = [];
  return {
    bodies,
    chat: async (body: Body) => {
      bodies.push(body);
      if (typeof reply === "function") (reply as () => never)();
      return reply;
    },
  };
}

test("concordância, recusa e nenhuma das duas voltam como vieram do modelo", async () => {
  for (const answer of ["agree", "refuse", "neither"] as Agreement[]) {
    const reader = createAgreementReader({ ollama: fakeOllama({ answer }) });
    assert.equal(await reader({ text: "qualquer coisa" }), answer);
  }
});

test("resposta fora do formato, sem resposta ou não JSON vira null", async () => {
  const invalid = [{ answer: "maybe" }, {}, null, "pode sim"];
  for (const reply of invalid) {
    const reader = createAgreementReader({ ollama: fakeOllama(reply) });
    assert.equal(await reader({ text: "pode sim" }), null, JSON.stringify(reply));
  }
});

test("falha do Ollama vira null e registra o erro", async () => {
  const logged: object[] = [];
  const down = fakeOllama(() => {
    throw new TypeError("fetch failed");
  });
  const reader = createAgreementReader({ ollama: down });
  assert.equal(await reader({ text: "pode sim", log: { error: (obj) => logged.push(obj) } }), null);
  assert.equal(logged.length, 1);
});

test("só a mensagem do cliente vai ao modelo, sem histórico nem etapa", async () => {
  const ollama = fakeOllama({ answer: "agree" });
  await createAgreementReader({ ollama })({ text: "pode sim camarada" });
  assert.deepEqual(ollama.bodies[0].messages.map((m) => m.role), ["system", "user"]);
  assert.equal(ollama.bodies[0].messages[1].content, "pode sim camarada");
});
