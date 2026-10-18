import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEvolutionEvent } from "./evolution.js";

function upsert(overrides: { key?: object; message?: object; event?: string; pushName?: string } = {}) {
  return {
    event: overrides.event ?? "messages.upsert",
    data: {
      key: { id: "MSG1", remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, ...overrides.key },
      pushName: overrides.pushName ?? "Cliente",
      messageTimestamp: 1792118106,
      message: overrides.message ?? { conversation: "How much are braces?" },
    },
  };
}

test("mensagem de texto do cliente", () => {
  assert.deepEqual(parseEvolutionEvent(upsert()), {
    kind: "message",
    id: "MSG1",
    phone: "5511999999999",
    pushName: "Cliente",
    fromMe: false,
    type: "text",
    text: "How much are braces?",
    sentAt: new Date(1792118106 * 1000),
  });
});

const content: [string, object, string, string | null][] = [
  ["extendedTextMessage", { extendedTextMessage: { text: "Hi" } }, "text", "Hi"],
  ["imagem com legenda", { imageMessage: { caption: "meu dente" } }, "image", "meu dente"],
  ["imagem sem legenda", { imageMessage: { url: "x" } }, "image", null],
  ["vídeo com legenda", { videoMessage: { caption: "olha" } }, "video", "olha"],
  ["áudio", { audioMessage: { seconds: 3 } }, "audio", null],
  ["documento", { documentMessage: { fileName: "exame.pdf" } }, "document", "exame.pdf"],
  ["documento com legenda", { documentWithCaptionMessage: { message: { documentMessage: { caption: "exame" } } } }, "document", "exame"],
  ["figurinha", { stickerMessage: {} }, "sticker", null],
  ["localização", { locationMessage: { degreesLatitude: 1 } }, "location", null],
  ["localização ao vivo", { liveLocationMessage: {} }, "location", null],
  ["contato", { contactMessage: { displayName: "Ana" } }, "contact", "Ana"],
  ["lista de contatos", { contactsArrayMessage: { displayName: "2 contatos" } }, "contact", "2 contatos"],
  ["tipo desconhecido", { pollCreationMessage: {} }, "other", null],
];

for (const [name, message, type, text] of content) {
  test(`tipo e texto: ${name}`, () => {
    const parsed = parseEvolutionEvent(upsert({ message }));
    assert.equal(parsed?.kind, "message");
    assert.deepEqual(parsed && "type" in parsed ? { type: parsed.type, text: parsed.text } : null, { type, text });
  });
}

test("mensagem enviada pelo número conectado não usa o pushName", () => {
  const parsed = parseEvolutionEvent(upsert({ key: { fromMe: true }, pushName: "Clínica" }));
  assert.equal(parsed?.kind === "message" && parsed.fromMe, true);
  assert.equal(parsed?.kind === "message" ? parsed.pushName : "x", undefined);
});

test("send.message e nomes em maiúsculas são tratados como messages.upsert", () => {
  assert.equal(parseEvolutionEvent(upsert({ event: "send.message" }))?.kind, "message");
  assert.equal(parseEvolutionEvent(upsert({ event: "MESSAGES_UPSERT" }))?.kind, "message");
});

test("connection.update", () => {
  assert.deepEqual(
    parseEvolutionEvent({ event: "connection.update", data: { state: "open", wuid: "5511988887777:3@s.whatsapp.net" } }),
    { kind: "connection", state: "open", number: "5511988887777" },
  );
  assert.deepEqual(parseEvolutionEvent({ event: "connection.update", data: { state: "refused" } }), {
    kind: "connection",
    state: "close",
    number: null,
  });
});

test("qrcode.updated", () => {
  assert.deepEqual(
    parseEvolutionEvent({ event: "qrcode.updated", data: { qrcode: { base64: "data:image/png;base64,AAA" } } }),
    { kind: "qrcode", qr: "data:image/png;base64,AAA" },
  );
});

const ignored: [string, unknown][] = [
  ["grupo", upsert({ key: { remoteJid: "123456@g.us" } })],
  ["status", upsert({ key: { remoteJid: "status@broadcast" } })],
  ["sem id", upsert({ key: { id: undefined } })],
  ["texto só com espaços", upsert({ message: { conversation: "   " } })],
  ["reação", upsert({ message: { reactionMessage: { text: "👍" } } })],
  ["mensagem apagada", upsert({ message: { protocolMessage: { type: 0 } } })],
  ["só metadados", upsert({ message: { messageContextInfo: {} } })],
  ["evento desconhecido", { event: "presence.update", data: {} }],
  ["corpo vazio", {}],
];

for (const [name, body] of ignored) {
  test(`ignora: ${name}`, () => {
    assert.equal(parseEvolutionEvent(body), null);
  });
}
