import assert from "node:assert/strict";
import { test } from "node:test";
import { verifySigned } from "../../config/crypto.js";
import { buildConnectUrl, CONNECT_STATE, GOOGLE_SCOPES, isGoogleConfigured, missingScopes } from "./oauth.js";

test("isGoogleConfigured recusa valores de exemplo", () => {
  assert.equal(isGoogleConfigured("nao-configurado", "nao-configurado"), false);
  assert.equal(isGoogleConfigured("123456789012-abc123def456.apps.googleusercontent.com", "GOCSPX-abcdefghijklmnopqrstuvwx"), true);
  assert.equal(isGoogleConfigured("123456789012-abc123def456.apps.googleusercontent.com", ""), false);
});

test("URL de consentimento: offline, consent, os escopos de agenda e o state assinado", () => {
  const url = new URL(buildConnectUrl());
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/auth/google/callback");
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), GOOGLE_SCOPES);
  assert.deepEqual(GOOGLE_SCOPES, [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
  ]);
  assert.equal(verifySigned(url.searchParams.get("state")!), CONNECT_STATE);
});

test("missingScopes aponta os escopos de agenda que o operador desmarcou", () => {
  assert.deepEqual(missingScopes("openid email https://www.googleapis.com/auth/calendar.events"), [
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
  ]);
  assert.deepEqual(missingScopes(GOOGLE_SCOPES.join(" ")), []);
});
