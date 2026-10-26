# 0008 · Reminders only inside the 24 h window

**Status:** Accepted · **Date:** 2026-10-25

## Context
A WhatsApp reminder the day before reduces no-shows. But the anti-ban rules say the assistant never writes to someone whose last message is older than 24 h ([BR-AB-03](../business-rules.md#br-ab-03--never-write-first-24-h-window)), and most patients book days ahead and then go quiet. During the feature 006 clarification, the product owner chose between allowing an exception for reminders and keeping the rule absolute (option B).

## Decision
Option B: no exception. The reminder is an ordinary assistant message through the gate. It's sent only if the patient wrote in the last 24 h. Otherwise, and when the phone never wrote at all, the Appointments tab shows **Remind manually** so staff contact the patient themselves and click **Confirm**.

## Alternatives considered
- An exception to the 24 h rule for reminders: more reminders delivered, but every one is an unsolicited message from an unofficial number, the riskiest kind of send.
- Reminders only by staff: safe, but loses the automatic ones that are possible.

## Consequences
- The ban-risk profile of the number doesn't change with this feature.
- In practice many reminders will be manual; the panel makes them visible instead of silently not sending.
- If the clinic moves to the official WhatsApp platform, template messages would allow automatic reminders outside the window; this decision should then be revisited.

**Evidence:** `remind()` in [scheduler.ts](../../src/modules/reminders/scheduler.ts), `reminderLabel` in [status.ts](../../src/modules/reminders/status.ts), [specs/006 spec](../../specs/006-panel-appointments-reminders/spec.md), [specs/006 research R4](../../specs/006-panel-appointments-reminders/research.md)
