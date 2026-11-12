# 0019 · Assessment and follow-up are clinic toggles

**Status:** Accepted · **Date:** 2026-11-12

## Context
The general assessment (`Assessment`) was a constant in code and the booking list always offered it, with no way for the clinic to switch it off or give it a length. The follow-up visit did not exist as a service. The stored name and the labels of the two fixed services were written in code and read from several files (catalog, interpreter prompt, replies, routes, reminders), and [ADR 0014](0014-booking-services-are-the-clinics-treatments.md) made the treatments a snapshot refreshed on each panel change, which left the two fixed services without a source in the clinic's settings.

## Decision
1. **Two switches in `clinic_settings`**, edited in the panel's Clinic tab: `offer_assessment` (on by default) and `offer_follow_up` (off by default).
2. **An optional length for each**: `assessment_minutes` and `follow_up_minutes`, from 15 to 240 in steps of 5 (check constraints). Empty means the calendar's default length ([ADR 0015](0015-appointment-length-per-treatment-and-time-grid.md)).
3. **The follow-up visit is a fixed service**, stored as `FollowUp` and labelled "Follow-up visit" / "Retorno". It sits after the treatments; the assessment stays last. The two fixed labels in each language are the only service texts kept in code (`FIXED_LABELS` in `catalog.ts`).
4. **The clinic offers are read live.** The catalog receives the clinic context and builds the list on every call, so a switch applies to the next message with no restart. The treatments are still the knowledge table's snapshot, refreshed at boot and after each panel change ([ADR 0014](0014-booking-services-are-the-clinics-treatments.md), point 4, partly superseded here).
5. **No service is assumed.** A switched-off fixed service is not offered. When the patient has none chosen, the assistant asks for one from the list.
6. **Stored rows keep their meaning.** Appointments already stored as `Assessment` or `FollowUp` keep the stored name, their label and their length. Switching a service off changes only new bookings.

## Alternatives considered
- **Keep the assessment fixed and add only the follow-up:** the clinic could not turn the assessment off without a code change.
- **Store the two fixed services as rows of the knowledge table:** their labels would be the clinic's words, but the stored key and the default would still have to live in code, and editing the table could make the assessment disappear from bookings.

## Consequences
- Migration `drizzle/0014_acoustic_timeslip.sql` adds the four columns and their checks; existing clinics keep the assessment on and the follow-up off, so their list does not change.
- With the follow-up on, the interpreter's service enum has one more entry; the schema is built per call, so the list stays current.
- The fixed labels remain in code in both languages, the one exception to "labels are the clinic's words" (ADR 0014, point 5).
- Test appointments stored under the old names are not migrated.
