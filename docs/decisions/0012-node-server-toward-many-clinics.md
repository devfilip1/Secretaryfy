# 0012 · The Node server toward many clinics: one clinic context first, the tenant key later

**Status:** Proposed (steps 1 and 3 accepted and done; step 2 done for the name, assistant name and kind) · **Date:** 2026-11-05

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
2. **The clinic lives in the database, edited in an admin panel (owner decision 2026-11-05).** *Step note (2026-11-06):* the name, assistant name and kind are in the single-row `clinic_settings` table, seeded from the env on the first start, edited at `/api/clinic-settings` and applied without a restart (`ClinicContext` is a holder that the consumers read on each use). The language stays in the env and needs a restart. The RAG reads the clinic identity (name and kind) from Node at `GET /internal/clinic` when `CLINIC_URL` is set; the specialty words stay in the YAML until an Assistant tab exists. Still open: the `clinics` table, the service catalog (already in the knowledge table) and the knowledge texts. One `clinics` row holds name, assistant name, language and kind; the panel edits it and both the Node server and the RAG service read it from there (the RAG over the API, no YAML parser in Node). The clinic YAML becomes a seed or an export. The same panel will hold the service catalog and the knowledge texts (step 4) and re-embed on save.
3. **Integrations as dependencies (done).** Evolution (URL, instance, key, webhook) and the Google client become `createX(deps)` like the rest, instead of import-time env reads.
4. **The service catalog belongs to the clinic,** with a stable key stored in `appointments.service` instead of the English name (needs a migration of existing rows).
5. **Tenant key.** A `clinics` table, `clinic_id` on every table, the `id = 1` tables keyed by clinic, phone uniqueness by `(clinic_id, phone)`. Repositories take the clinic in `createX({ db, clinicId })`, one table at a time, each with a PGlite test.
6. **In-memory state keyed by clinic** (lock, bus with a clinic filter, gate, breaker, reminder timer, instance manager), and the webhook routes the Evolution instance to its clinic with a token per clinic.
7. **Per-clinic Google connection** (the OAuth state carries the clinic) and per-clinic RAG profile (the clinic sent with each question).
8. **Panel login per clinic** (users and sessions instead of one `OPERATOR_PASSWORD`).

Steps 1 to 4 serve both deployment shapes. Steps 5 to 8 are what many clinics in one process need, and that is the chosen target.

## Alternatives considered
- **One deployment per clinic now:** no tenant key at all, strongest isolation, but every copy wants the models in GPU memory, and updates multiply.
- **Big-bang tenant migration first:** touches ~90 queries at once with no way to ship anything in between.

## Consequences
- Each step is a separate change with its own tests and live check in the fake WhatsApp chat.
- Owner decisions (2026-11-05): many clinics in one process (answers ADR 0010 Q1), so steps 5 to 8 are the target; a cloud model is accepted for the future (LGPD contract and patient consent to be settled before a clinic uses it, ADR 0010 Q4); clinic data moves from YAML to the database, edited in an admin panel.
- Still open: the migration of stored `appointments.service` names to stable keys (step 4), and who edits the knowledge texts in the panel (clinic or developers).
- Anti-ban limits and warmup are per WhatsApp number, so each clinic needs its own number and protection state whatever the process shape.
