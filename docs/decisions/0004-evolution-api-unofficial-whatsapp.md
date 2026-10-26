# 0004 · Unofficial WhatsApp connection through the Evolution API

**Status:** Reconstructed · **Date:** 2026-10 (feature 001)

## Context
The clinic wants the assistant on its existing WhatsApp number. Meta's official WhatsApp Business Platform requires business verification, approved templates for messages outside the 24 h window and per-conversation fees. The Evolution API is open source, runs in Docker and connects any number by QR code, like WhatsApp Web.

> ⚠️ Inferred: the reasons above come from the README and the anti-ban spec, which state the trade-off but not why the official platform was not chosen.

## Decision
Use the Evolution API v2.3.7 (Baileys integration) in Docker, pinned to an exact version, with its data in the same Postgres. Secretaryfy talks to it over REST and receives a webhook.

## Alternatives considered
- Meta WhatsApp Cloud API: no ban risk, but verification, templates and cost.
- Other unofficial libraries embedded in Node: same risk, less isolation, and third-party "anti-ban" builds have been caught stealing sessions.

## Consequences
- Free, fast to set up, works with the clinic's own number and lets the clinic's phone keep using WhatsApp.
- WhatsApp's terms don't allow this kind of automation: the number can be banned. This is why the anti-ban gate exists ([ADR 0003](0003-single-send-gate.md)) and why the assistant never writes first ([ADR 0008](0008-reminder-only-inside-24h-window.md)). The README and the panel say plainly that the risk is reduced, not removed.
- Moving to the official platform later would mean replacing [evolution.ts](../../src/modules/whatsapp/evolution.ts) and [instance.ts](../../src/modules/whatsapp/instance.ts); the gate and the rest of the pipeline stay.

**Evidence:** [docker-compose.yml](../../docker-compose.yml), [instance.ts](../../src/modules/whatsapp/instance.ts), [specs/004 spec](../../specs/004-whatsapp-anti-ban/spec.md)
