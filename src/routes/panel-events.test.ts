import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { createSessionToken, SESSION_COOKIE } from "../modules/auth/session.js";
import { createEventBus } from "../modules/inbox/events.js";
import { panelEventsRoutes } from "./panel-events.js";
import { registerPanelAuth } from "./panel-session.js";

test("SSE: entrega os eventos, exige sessão e libera a assinatura ao fechar", async () => {
  const bus = createEventBus();
  const calls: string[] = [];
  const app = Fastify();
  await app.register(cookie);
  registerPanelAuth(app, { password: "senha-do-operador", publicUrl: "http://localhost:3000" });
  await app.register(panelEventsRoutes({ bus, onFirst: () => calls.push("first"), onLast: () => calls.push("last") }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  try {
    assert.equal((await fetch(`${base}/api/events`)).status, 401);

    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, {
      headers: { cookie: `${SESSION_COOKIE}=${createSessionToken()}` },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/event-stream/);
    assert.equal(bus.subscriberCount(), 1);
    assert.deepEqual(calls, ["first"]);

    bus.publish({ type: "connection.updated", state: "open", number: "5511988887777", qr: null });

    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: connection.updated")) text += new TextDecoder().decode((await reader.read()).value);
    while (!text.endsWith("\n\n")) text += new TextDecoder().decode((await reader.read()).value);
    const block = text.split("\n\n").find((b) => b.startsWith("event: connection.updated"))!;
    assert.deepEqual(JSON.parse(block.split("\ndata: ")[1]), { state: "open", number: "5511988887777", qr: null });

    controller.abort();
    for (let i = 0; i < 50 && bus.subscriberCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(bus.subscriberCount(), 0);
    assert.deepEqual(calls, ["first", "last"]);
  } finally {
    await app.close();
  }
});
