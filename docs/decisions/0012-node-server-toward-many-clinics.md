# 0012 · The Node server toward many clinics: one clinic context first, the tenant key later

**Status:** Proposed (step 1 accepted and done) · **Date:** 2026-11-05

## Context
[ADR 0010](0010-multi-clinic-and-knowledge-table.md) leaves the Node server open: it is the hard part of serving many clinics. An audit of `src/` (2026-11-05) found:

- **Clinic identity read in many places.** `CLINIC_NAME`, `CLINIC_LANGUAGE` and `ASSISTANT_NAME` were read from the env in two composition files, and modules carried hidden defaults: `createInterpreter` defaulted to "DentalSafe", `replies.ts` exported an English DentalSafe instance used as a fallback by the flow, the router and the reminders, and `antiban/texts.ts` exported English fixed texts as a default.
- **Integrations read the env at import time.** `whatsapp/evolution.ts`, `whatsapp/instance.ts` and `google/oauth.ts` read the Evolution URL, instance and key, the webhook base URL and the Google client directly.
- **One process, one clinic in memory** ([ADR 0007](0007-single-process-in-memory-coordination.md)): calendar lock, SSE bus, gate and breaker, reminder timer, instance manager, webhook token.
- **No table has a clinic key.** Three are single-row (`id = 1`: calendar connection, scheduling rules, protection state); four are unique on a phone or number. About 90 queries would need a clinic scope.
- **The service catalog** is one list in `scheduling/services.ts`, and its English names are stored in `appointments.service`.

## Decision (proposed)
Move in small steps that each keep behavior and tests, so that the choice between "one process for all clinics" and "one process per clinic" (ADR 0010, open question 1) stays cheap until it is made.

1. **One clinic context (done).** `ClinicContext` (name, assistant name, language, kind) is built once in the composition (`routes/scheduling.ts`, from the env) and injected into the interpreter, the replies, the humanizer and the fixed texts. Modules have no clinic defaults; tests use `src/test/clinic.ts`.
2. **The clinic is a file shared with the RAG.** The Node server reads the same `config/clinics/<slug>.yaml` as the RAG service, so name, language and kind exist once and can no longer disagree. The env keeps only the slug. Needs a YAML parser dependency (owner's OK).
3. **Integrations as dependencies.** Evolution (URL, instance, key, webhook) and the Google client become `createX(deps)` like the rest, instead of import-time env reads.
4. **The service catalog belongs to the clinic,** with a stable key stored in `appointments.service` instead of the English name (needs a migration of existing rows).
5. **Tenant key.** A `clinics` table, `clinic_id` on every table, the `id = 1` tables keyed by clinic, phone uniqueness by `(clinic_id, phone)`. Repositories take the clinic in `createX({ db, clinicId })`, one table at a time, each with a PGlite test.
6. **In-memory state keyed by clinic** (lock, bus with a clinic filter, gate, breaker, reminder timer, instance manager), and the webhook routes the Evolution instance to its clinic with a token per clinic.
7. **Per-clinic Google connection** (the OAuth state carries the clinic) and per-clinic RAG profile (the clinic sent with each question).
8. **Panel login per clinic** (users and sessions instead of one `OPERATOR_PASSWORD`).

Steps 1 to 4 serve both deployment shapes. Steps 5 to 8 are only needed for many clinics in one process; with one process per clinic behind a router they reduce to configuration.

## Alternatives considered
- **One deployment per clinic now:** no tenant key at all, strongest isolation, but every copy wants the models in GPU memory, and updates multiply.
- **Big-bang tenant migration first:** touches ~90 queries at once with no way to ship anything in between.

## Consequences
- Each step is a separate change with its own tests and live check in the fake WhatsApp chat.
- Owner decisions still open: process shape (ADR 0010 Q1), cloud model and LGPD (Q4), the YAML dependency (step 2), and the service-key migration (step 4).
- Anti-ban limits and warmup are per WhatsApp number, so each clinic needs its own number and protection state whatever the process shape.
