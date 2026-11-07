import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEvolutionEvent, type ConnectionEvent, type IncomingMessage } from "../../src/modules/whatsapp/evolution.js";
import { buildConnectionOpen, buildMessageUpsert, webhookTarget } from "./payload.js";
import { assertLocalDevHost, isAuthorized } from "./safety.js";

test("mensagem do cliente montada pelo fake vira IncomingMessage no parser do app", () => {
  const payload = buildMessageUpsert({
    instance: "secretaryfy",
    phone: "5511988887777",
    name: "Maria",
    text: "Quero marcar uma limpeza",
    id: "FAKE-IN-1",
    timestamp: 1_700_000_000,
  });

  // Passa por JSON, como no webhook de verdade
  const event = parseEvolutionEvent(JSON.parse(JSON.stringify(payload))) as IncomingMessage;

  assert.equal(event.kind, "message");
  assert.equal(event.phone, "5511988887777");
  assert.equal(event.text, "Quero marcar uma limpeza");
  assert.equal(event.fromMe, false);
  assert.equal(event.id, "FAKE-IN-1");
  assert.equal(event.pushName, "Maria");
});

test("connection.update open do fake vira ConnectionEvent com o número da clínica", () => {
  const event = parseEvolutionEvent(buildConnectionOpen("secretaryfy", "5511900000000")) as ConnectionEvent;

  assert.equal(event.kind, "connection");
  assert.equal(event.state, "open");
  assert.equal(event.number, "5511900000000");
  assert.equal(event.loggedOut, undefined);
});

test("só aceita iniciar com a Evolution apontada para host local fora de produção", () => {
  assert.doesNotThrow(() => assertLocalDevHost("http://localhost:8080", "development"));
  assert.doesNotThrow(() => assertLocalDevHost("http://127.0.0.1:8080", undefined));
  assert.doesNotThrow(() => assertLocalDevHost("http://[::1]:8080", undefined));

  assert.throws(() => assertLocalDevHost("https://evo.clinica.com.br", undefined), /só roda em localhost/);
  assert.throws(() => assertLocalDevHost("http://localhost:8080", "production"), /NODE_ENV=production/);
  assert.throws(() => assertLocalDevHost(undefined, undefined), /EVOLUTION_API_URL não definido/);
});

test("rejeita apikey ausente, errada ou de tamanho diferente", () => {
  assert.equal(isAuthorized("segredo-dev", "segredo-dev"), true);
  assert.equal(isAuthorized("segredo-errado", "segredo-dev"), false);
  assert.equal(isAuthorized("segredo", "segredo-dev"), false);
  assert.equal(isAuthorized(undefined, "segredo-dev"), false);
  assert.equal(isAuthorized("qualquer", ""), false);
});

test("troca a origem do webhook (WEBHOOK_BASE_URL do Docker) pela do app e mantém o token", () => {
  const stored = "http://host.docker.internal:3000/webhooks/evolution?token=abc123";
  assert.equal(webhookTarget(stored, "http://localhost:3000"), "http://localhost:3000/webhooks/evolution?token=abc123");
});
