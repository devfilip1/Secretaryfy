# 0003 · One gate for every outgoing WhatsApp message

**Status:** Accepted · **Date:** 2026-10-18

## Context
The number is connected unofficially ([ADR 0004](0004-evolution-api-unofficial-whatsapp.md)), so bursts, cold contacts, repeated texts and bot loops can get it banned. Limits like "8 messages per minute" must count the assistant and the operator together; any second sending path would escape them.

## Decision
All sends go through one module, [src/modules/antiban/](../../src/modules/antiban): `gate.sendAssistant` for the assistant (rules in a fixed order, then read receipt, typing, queue) and `gate.sendOperator` for the panel (only the queue; the operator confirms risks beforehand). Nothing else may call the Evolution send function. Per-minute and per-hour counts are kept in memory but seeded from the database at startup; the 24 h conversation count is read from the database. The queue is an in-memory FIFO with one worker. Replies left in the queue at shutdown are marked `blocked` and never sent later.

Feature 006 added `gate.assistantBlockReason`, which runs the same rules without recording anything, so the reminder scheduler can check every minute without filling the history with blocked attempts.

## Alternatives considered
- Limits in the Evolution API: it has no per-number limit, and its `delay` doesn't space different conversations.
- An HTTP proxy in front of the Evolution API: one more component, no gain with one process.
- A persisted queue: would resend everything after a restart, the burst the gate exists to prevent.

## Consequences
- One place to reason about risk; every refused message is stored as `blocked` with its reason and shown in the panel.
- New features that send (reminders) get the protection for free, and must use the gate.
- Replies are slower on purpose (seconds of "typing…").
- The in-memory queue ties the server to a single process ([ADR 0007](0007-single-process-in-memory-coordination.md)).

**Evidence:** [gate.ts](../../src/modules/antiban/gate.ts), [queue.ts](../../src/modules/antiban/queue.ts), [specs/004 research R1–R2](../../specs/004-whatsapp-anti-ban/research.md)
