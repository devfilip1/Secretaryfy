# 0007 · Single process with in-memory coordination

**Status:** Reconstructed · **Date:** 2026-10 (features 002 to 006)

## Context
Secretaryfy serves one clinic from one machine. Several features needed coordination: real-time panel updates, a send queue with rate limits, a lock against double booking, debouncing patient messages, login rate limiting and a reminder timer. Redis already runs (for the Evolution API), but adding cross-process coordination has a cost.

## Decision
Run the Node server as a single process and keep coordination in memory:

| Piece | Where |
|---|---|
| Event bus for SSE (`EventEmitter`) | [inbox/events.ts](../../src/modules/inbox/events.ts) |
| Send queue and per-minute/hour counters | [antiban/queue.ts](../../src/modules/antiban/queue.ts), [gate.ts](../../src/modules/antiban/gate.ts) |
| Calendar lock (promise chain) | [scheduling/lock.ts](../../src/modules/scheduling/lock.ts) |
| Message debouncer | [antiban/debounce.ts](../../src/modules/antiban/debounce.ts) |
| Breaker counters (state persisted) | [antiban/breaker.ts](../../src/modules/antiban/breaker.ts) |
| Login attempts | [auth/login-limiter.ts](../../src/modules/auth/login-limiter.ts) |
| Reminder scheduler (`setInterval`, 60 s) | [reminders/scheduler.ts](../../src/modules/reminders/scheduler.ts) |

What must survive a restart is in Postgres: messages (and so the send counts), reminder state, the brake's pause, sessions.

## Alternatives considered
- Redis or Postgres advisory locks and queues: needed only with several instances.
- An external cron or job runner for reminders: one more thing to install on Windows.

## Consequences
- Simple, fast, no extra infrastructure, and fully testable with injected clocks and timers.
- **Running two server instances is unsafe:** double bookings become possible, limits double, SSE clients miss events from the other instance, and reminders could be sent twice (only the database's "still pending" check stands in the way). Scaling out means replacing each piece in the table.
- A restart drops the queue (by design) and pending debounced replies.

**Evidence:** the files in the table; comments in [lock.ts](../../src/modules/scheduling/lock.ts) and [specs/004 research R2](../../specs/004-whatsapp-anti-ban/research.md), [specs/006 research R3](../../specs/006-panel-appointments-reminders/research.md)
