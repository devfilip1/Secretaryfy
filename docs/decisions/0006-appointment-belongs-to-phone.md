# 0006 · The appointment belongs to the phone, with one booking engine

**Status:** Accepted · **Date:** 2026-10-25

## Context
Until feature 005, an appointment required a conversation and was deleted in cascade with it. "Delete all conversations" and disconnecting the number silently erased every appointment, and a booking made from the panel for a patient who only phoned had no conversation at all. Feature 006 also needed the panel to book with exactly the same checks as the assistant.

## Decision
- `appointments.phone` (not null) is the owner. `conversation_id` became optional with `ON DELETE SET NULL` and only records where the booking started. The conversation is found by phone when needed (`conversations.phone` is unique).
- "One upcoming appointment per number" and the assistant's lookup of "my appointment" use the phone.
- The booking code moved out of the flow into `bookSlot` in [booking.ts](../../src/modules/scheduling/booking.ts), used by both the WhatsApp flow and `POST /api/appointments`. It returns `booked`, `slot_taken`, `already_booked` or `calendar_unavailable`.
- Migration 0006 backfilled `phone` from the conversations before making it `NOT NULL`.

## Alternatives considered
- Create an empty conversation for each panel booking: clutters the conversation list and still deletes in cascade.
- Keep the cascade and warn on the delete button: breaks the Appointments tab and reminders after any cleanup.

## Consequences
- Appointments, the customer registry and opt-outs all survive conversation cleanup; the assistant finds a panel booking when the patient writes.
- One engine means one place for the lock, the rules and the double-booking barrier.
- The phone format must be the same everywhere (WhatsApp's digits with country code), which is why panel input is normalized ([BR-SCH-12](../business-rules.md#br-sch-12--panel-bookings-use-the-same-engine-and-send-nothing)).

**Evidence:** [schema.ts](../../src/db/schema.ts) (`appointments`), [drizzle/0006_appointments_panel.sql](../../drizzle/0006_appointments_panel.sql), [booking.ts](../../src/modules/scheduling/booking.ts), [specs/006 research R1–R2](../../specs/006-panel-appointments-reminders/research.md)
