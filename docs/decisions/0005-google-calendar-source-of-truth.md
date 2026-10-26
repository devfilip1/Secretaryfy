# 0005 · Google Calendar as the source of truth

**Status:** Accepted · **Date:** 2026-10-18

## Context
The clinic already runs its day in Google Calendar and edits it by hand: blocks lunch, moves patients, deletes events. Secretaryfy needs its own record of appointments for rules (one per phone, cancellation deadline), reminders and the panel, and the two must not disagree in ways that hurt a patient.

## Decision
- Free times are computed from **any** busy event on the selected calendar (free/busy), not only Secretaryfy's events.
- The `appointments` table is a local copy. Before using one (cancel, reschedule, reminder, "my appointment", panel lookup) it is reconciled with `events.get`: deleted in Google means cancelled, moved in Google means the new time is adopted.
- Writes go to Google first, then to the database; if the database rejects the row (unique start time), the Google event is deleted.
- Double booking is prevented by a process-wide lock with a fresh free/busy read inside it, plus a unique index on `(calendar_id, starts_at)` for booked appointments.

## Alternatives considered
- Secretaryfy as the source of truth, pushing to Google: staff edits in Google would be ignored or overwritten.
- Two-way sync with push notifications from Google: needs a public HTTPS webhook and channel renewals; reconcile-on-read is enough at a clinic's volume.

## Consequences
- Staff keep using Google Calendar freely; the assistant never offers a time they blocked.
- Each use of an appointment costs one Google call, and Google being down blocks booking (the patient is told, the panel gets 502).
- The local table can be briefly stale (e.g. the panel list) until the next read reconciles it.

**Evidence:** `syncAppointment` and `bookSlot` in [booking.ts](../../src/modules/scheduling/booking.ts), [lock.ts](../../src/modules/scheduling/lock.ts), [calendar.ts](../../src/modules/google/calendar.ts), [specs/003 research R6–R9](../../specs/003-google-calendar-scheduling/research.md)
