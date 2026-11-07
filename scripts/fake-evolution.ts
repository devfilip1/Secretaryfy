// Evolution API falsa para testar o fluxo do WhatsApp sem conta: webhook -> inbox -> roteador -> gate -> sendText.
// Só para desenvolvimento. Não é a Evolution real: responde às rotas que o app chama e tem um chat em http://localhost:8080.
// Uso: npm run dev:whatsapp (com o app rodando em outro terminal: npm run dev)
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { assertLocalDevHost, isAuthorized } from "./fake-evolution/safety.js";
import { buildConnectionOpen, buildMessageUpsert, webhookTarget } from "./fake-evolution/payload.js";

const PORT = Number(process.env.FAKE_EVOLUTION_PORT ?? 8080);
const API_KEY = process.env.EVOLUTION_API_KEY ?? "";
const INSTANCE = process.env.EVOLUTION_INSTANCE ?? "secretaryfy";
// Onde o app escuta; o webhook guardado pode apontar para outro host (WEBHOOK_BASE_URL do Docker)
const APP_ORIGIN = `http://localhost:${process.env.PORT ?? 3000}`;
const CLINIC_NUMBER = "5511900000000";
// Espera máxima do sendText, para o dev não ficar lento; o atraso real é logado
const MAX_TYPING_WAIT_MS = 3000;
const OPEN_AFTER_CONNECT_MS = 1500;
const QR_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#fff"/><text x="120" y="125" text-anchor="middle" font-family="sans-serif" font-size="20">FAKE QR</text></svg>',
).toString("base64")}`;
const CHAT_PAGE = readFileSync(new URL("./fake-evolution/chat.html", import.meta.url), "utf8");

type Connection = "close" | "connecting" | "open";

interface ChatMessage {
  n: number;
  direction: "in" | "out";
  phone: string;
  name?: string;
  text: string;
  id: string;
  at: string;
}

const state = {
  created: false,
  connection: "close" as Connection,
  owner: null as string | null,
  webhookUrl: null as string | null,
  messages: [] as ChatMessage[],
  /** quantos sendText estão em "digitando…" por número */
  typing: new Map<string, number>(),
  counter: 0,
  /** número da última mensagem do chat; não volta atrás quando o chat é limpo */
  seq: 0,
  openTimer: null as NodeJS.Timeout | null,
};

/** Muda a cada início: o app descarta como repetido um id que já tem no banco (o contador volta a 1 ao reiniciar). */
const BOOT_ID = Date.now().toString(36);

function nextId(prefix: string): string {
  state.counter += 1;
  return `${prefix}${BOOT_ID}-${state.counter}`;
}

function record(message: Omit<ChatMessage, "n" | "at">): ChatMessage {
  const stored: ChatMessage = { ...message, n: ++state.seq, at: new Date().toISOString() };
  state.messages.push(stored);
  return stored;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function evolutionError(res: ServerResponse, status: number, message: string) {
  sendJson(res, status, { status, error: message, response: { message } });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Entrega um evento ao webhook do app. Lança erro se o app não responder com 2xx. */
async function postToWebhook(body: unknown): Promise<void> {
  if (!state.webhookUrl) throw new Error("webhook não configurado");
  const target = webhookTarget(state.webhookUrl, APP_ORIGIN);
  const res = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`o app respondeu ${res.status} em ${target}`);
}

// --- Rotas que o app chama na Evolution API (contracts/evolution.md) ---

async function handleSendText(res: ServerResponse, body: Record<string, unknown>) {
  const number = typeof body.number === "string" ? body.number : "";
  const text = typeof body.text === "string" ? body.text : "";
  const delay = typeof body.delay === "number" && body.delay > 0 ? body.delay : 0;
  if (!number || !text) return evolutionError(res, 400, "number e text são obrigatórios");
  if (state.connection !== "open") return evolutionError(res, 400, "Connection Closed");

  const wait = Math.min(delay, MAX_TYPING_WAIT_MS);
  console.log(`sendText para ${number}: delay ${delay} ms, espera ${wait} ms`);
  state.typing.set(number, (state.typing.get(number) ?? 0) + 1);
  try {
    await sleep(wait);
  } finally {
    const left = (state.typing.get(number) ?? 1) - 1;
    if (left > 0) state.typing.set(number, left);
    else state.typing.delete(number);
  }

  const id = nextId("FAKE-");
  record({ direction: "out", phone: number, text, id });
  sendJson(res, 201, { key: { id, remoteJid: `${number}@s.whatsapp.net`, fromMe: true }, message: { conversation: text } });
}

function handleConnect(res: ServerResponse) {
  if (!state.created) return evolutionError(res, 404, `The "${INSTANCE}" instance does not exist`);
  if (state.connection === "open") return sendJson(res, 200, { count: 0 });

  state.connection = "connecting";
  console.log("QR code gerado; pareamento simulado em 1,5 s");
  if (state.openTimer) clearTimeout(state.openTimer);
  state.openTimer = setTimeout(() => {
    state.openTimer = null;
    state.connection = "open";
    state.owner = CLINIC_NUMBER;
    console.log(`número ${CLINIC_NUMBER} conectado`);
    postToWebhook(buildConnectionOpen(INSTANCE, CLINIC_NUMBER)).catch((err: Error) => {
      console.error(`connection.update não entregue: ${err.message}`);
    });
  }, OPEN_AFTER_CONNECT_MS);
  sendJson(res, 200, { pairingCode: null, code: "fake", base64: QR_DATA_URI, count: 1 });
}

async function handleApiRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  const body = method === "POST" || method === "PUT" ? await readJson(req) : {};
  if (body === null) return evolutionError(res, 400, "JSON inválido");

  const sendMatch = /^\/message\/sendText\/[^/]+$/.test(path);
  if (method === "POST" && sendMatch) return handleSendText(res, body);

  if (method === "POST" && /^\/chat\/markMessageAsRead\//.test(path)) return sendJson(res, 200, {});

  if (method === "GET" && /^\/instance\/connectionState\//.test(path)) {
    if (!state.created) return evolutionError(res, 404, `The "${INSTANCE}" instance does not exist`);
    return sendJson(res, 200, { instance: { instanceName: INSTANCE, state: state.connection } });
  }

  if (method === "POST" && path === "/instance/create") {
    if (state.created) return evolutionError(res, 403, `The "${INSTANCE}" instance already exists`);
    state.created = true;
    return sendJson(res, 201, { instance: { instanceName: INSTANCE, status: "created" } });
  }

  if (method === "POST" && /^\/webhook\/set\//.test(path)) {
    if (!state.created) return evolutionError(res, 404, `The "${INSTANCE}" instance does not exist`);
    const webhook = body.webhook as { url?: unknown } | undefined;
    if (typeof webhook?.url !== "string") return evolutionError(res, 400, "webhook.url é obrigatório");
    state.webhookUrl = webhook.url;
    console.log(`webhook guardado: ${webhook.url.replace(/token=[^&]+/, "token=***")}`);
    return sendJson(res, 201, { webhook: body.webhook });
  }

  if (method === "GET" && /^\/instance\/connect\//.test(path)) return handleConnect(res);

  if (method === "GET" && path === "/instance/fetchInstances") {
    if (!state.created || !state.owner) return sendJson(res, 200, []);
    return sendJson(res, 200, [{ instanceName: INSTANCE, ownerJid: `${state.owner}@s.whatsapp.net`, status: state.connection }]);
  }

  if (method === "DELETE" && /^\/instance\/logout\//.test(path)) {
    if (state.openTimer) clearTimeout(state.openTimer);
    state.openTimer = null;
    state.connection = "close";
    state.owner = null;
    console.log("instância desconectada (logout); nenhum evento de 401 é enviado");
    return sendJson(res, 200, { status: "SUCCESS", error: false, response: { message: "Instance logged out" } });
  }

  console.warn(`rota não tratada: ${method} ${path}`);
  return evolutionError(res, 404, `Cannot ${method} ${path}`);
}

// --- Rotas do chat no navegador (sem apikey; o servidor só escuta em 127.0.0.1) ---

/** Limpa só a tela do chat deste número; o app (conversa, agendamento) não é afetado. */
async function handleChatClear(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const phone = typeof body?.phone === "string" ? body.phone : "";
  if (!/^\d{8,15}$/.test(phone)) return sendJson(res, 400, { error: "phone é obrigatório" });
  state.messages = state.messages.filter((m) => m.phone !== phone);
  sendJson(res, 200, { ok: true });
}

async function handleChatSend(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  if (!body) return sendJson(res, 400, { error: "JSON inválido" });
  const phone = typeof body.phone === "string" ? body.phone : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Customer";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!/^\d{8,15}$/.test(phone) || !text) return sendJson(res, 400, { error: "phone e text são obrigatórios" });
  if (!state.webhookUrl) return sendJson(res, 409, { error: "Connect the number in the panel first" });

  const id = nextId("FAKE-IN-");
  const payload = buildMessageUpsert({
    instance: INSTANCE,
    phone,
    name,
    text,
    id,
    timestamp: Math.floor(Date.now() / 1000),
  });
  try {
    await postToWebhook(payload);
  } catch (err) {
    // Sem o ?token= na mensagem, que volta ao navegador
    const target = webhookTarget(state.webhookUrl, APP_ORIGIN).split("?")[0];
    const detail = (err as Error).message;    console.error(`mensagem do cliente não entregue: ${detail}`);
    return sendJson(res, 502, { error: `Could not reach the app at ${target} (${detail}). Is npm run dev running?` });
  }
  record({ direction: "in", phone, name, text, id });
  sendJson(res, 200, { ok: true, id });
}

function handleChatMessages(res: ServerResponse, url: URL) {
  const since = Number(url.searchParams.get("since") ?? 0) || 0;
  const typing = [...state.typing.keys()];
  sendJson(res, 200, {
    messages: state.messages.filter((m) => m.n > since),
    typing,
    connection: { state: state.connection, number: state.owner, webhookSet: state.webhookUrl !== null },
  });
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(CHAT_PAGE);
    }
    if (req.method === "GET" && url.pathname === "/__chat/messages") return handleChatMessages(res, url);
    if (req.method === "POST" && url.pathname === "/__chat/send") return await handleChatSend(req, res);
    if (req.method === "POST" && url.pathname === "/__chat/clear") return await handleChatClear(req, res);

    if (!isAuthorized(req.headers.apikey as string | undefined, API_KEY)) {
      return evolutionError(res, 401, "Unauthorized");
    }
    return await handleApiRoute(req, res, url);
  } catch (err) {
    console.error("erro no fake:", err);
    if (!res.headersSent) evolutionError(res, 500, "erro interno do fake");
  }
}

// --- Inicialização ---

try {
  assertLocalDevHost(process.env.EVOLUTION_API_URL, process.env.NODE_ENV);
  if (!API_KEY) throw new Error("EVOLUTION_API_KEY não definido (rode com --env-file=.env)");
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

createServer((req, res) => {
  void handler(req, res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Evolution falsa em http://127.0.0.1:${PORT} (instância ${INSTANCE})`);
  console.log(`Chat: http://localhost:${PORT}  |  app: ${APP_ORIGIN}`);
  console.log("Conecte o número no painel (Connection > Connect) antes de conversar.");
});
