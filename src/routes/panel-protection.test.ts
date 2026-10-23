import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import type { ProtectionJson } from "../modules/antiban/limits.js";
import { panelProtectionRoutes } from "./panel-protection.js";

const NORMAL: ProtectionJson = {
  state: "normal",
  pausedUntil: null,
  reason: null,
  warmupUntil: null,
  limits: { perMinute: 8, perHour: 200, conversationsPerDay: 150 },
  usage: { lastMinute: 0, lastHour: 3, conversationsToday: 2 },
};

test("GET /api/protection devolve o estado do portão, normal ou pausado", async () => {
  let status = NORMAL;
  const app = Fastify();
  await app.register(panelProtectionRoutes({ gate: { protectionStatus: async () => status } }));
  assert.deepEqual((await app.inject({ url: "/api/protection" })).json(), NORMAL);

  status = { ...NORMAL, state: "paused", pausedUntil: "2026-10-18T15:30:00.000Z", reason: "send_failures" };
  const paused = (await app.inject({ url: "/api/protection" })).json();
  assert.deepEqual([paused.state, paused.reason], ["paused", "send_failures"]);
});
