# 0013 · Reminders may go out even when the patient has been silent for more than 24 h

**Status:** Accepted · **Date:** 2026-11-06 · Supersedes [0008](0008-reminder-only-inside-24h-window.md)

## Context
[0008](0008-reminder-only-inside-24h-window.md) kept the assistant from writing to a patient whose last message was older than 24 h, so most reminders ended as "Remind manually". The owner decided that the reminder must be sent: it is the whole point of the feature, the patient booked the appointment through this same chat, and reminders reduce no-shows.

## Decision
The reminder skips only the 24 h window rule (`outside_window`, [BR-AB-03](../business-rules.md#br-ab-03--never-write-first-24-h-window)). Every other rule of the number protection still applies to it: opt-out, pause, daily conversation limit (and its warm-up reduction), unanswered messages, loop detection, duplicates, rate limits and the send queue.
- `REMINDER_OUTSIDE_WINDOW` (default `1`) turns it off (`0` restores 0008).
- A phone with no conversation at all still gets "Remind manually": there is nothing to send into.
- One reminder per appointment, 24 h before and not later than 2 h before.

## Consequences
- This is the riskiest kind of message on an unofficial number: a message to someone who has not written for days. The risk is accepted by the owner; the limits above keep the volume low and tied to real appointments.
- The warm-up limit (conversations per day) now also counts cold reminders, so a new number reminds fewer patients per day until the warm-up ends.
- With the official WhatsApp platform, template messages make this safe; revisit the risk when the clinic moves there.

**Evidence:** `allowOutsideWindow` in [scheduler.ts](../../src/modules/reminders/scheduler.ts), `bypass` in [gate.ts](../../src/modules/antiban/gate.ts).
