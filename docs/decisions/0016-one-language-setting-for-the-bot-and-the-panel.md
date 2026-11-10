# 0016 · One language setting for the bot and the panel, panel translated with react-i18next

**Status:** Accepted (phases 1 and 2 done 2026-11-09; the panel, phase 3, follows) · **Date:** 2026-11-06

## Context
The patient-facing texts already exist in Portuguese and English (`replies.pt.ts`, `replies.en.ts`, the RAG language packs, the brochure labels), but the language is `CLINIC_LANGUAGE`, fixed at boot. The panel is English only: its texts are written inside the components. The clinic wants one choice: in English everything is English, in Portuguese everything is Portuguese, the panel included.

## Decision
1. **The language is one setting in the database** (`clinic_settings.language`, `en` or `pt`), edited in the panel's Clinic tab like the clinic name. `CLINIC_LANGUAGE` only seeds it on the first start (ADR 0012, step 2).
2. **The Node server reads it live.** The reply packs are built once for both languages and chosen at each message by the clinic context. The knowledge document, the booking service labels and the reminder texts follow the same value.
3. **The RAG loads the language pack of the identity it receives** from `GET /internal/clinic`, instead of only warning when it differs from the YAML (the profile keeps the YAML as fallback).
4. **The panel uses `react-i18next`.** One folder per language (`web/src/locales/en/`, `web/src/locales/pt/`) with one file per screen, as i18next namespaces (`common`, `inbox`, `appointments`, `calendar`, `customers`, `knowledge`, `clinic`, `connection`, `login`), so no file grows large and each screen loads only its own. Vite reads the folders with `import.meta.glob`, so a new file needs no list. Components call `useTranslation("inbox")` and `t("selectConversation")` instead of holding the text; keys name the meaning, not the English sentence. The language comes from the server setting, not from the browser, so the panel and the bot always agree; the login page, which has no session yet, uses a small public endpoint (`GET /api/language`) or the browser language.
5. **Dates, numbers and times** follow the language through `Intl` (already used in the panel); API error codes map to texts in the panel files, so the server keeps sending codes.
6. **Not translated:** the brochure text and the clinic's own words. Changing the language changes the labels and the assistant, not what the clinic wrote; the Clinic tab says so.

## Phases
1. Database column, migration, Clinic tab field, live language in the Node replies, humanizer and reminders (tests in both languages).
2. RAG: language pack from the identity; evaluation in English and Portuguese.
3. Panel: install `react-i18next`, the provider, the shared components (`Field`, `Notice`, `Page`) and the two files; then the pages one by one, the most used first (Conversations, Appointments, Knowledge, Calendar, Customers, Connection, Login).
4. A test that fails when a key exists in one language folder and not in the other (`i18next-parser` may list unused and missing keys), and a check that no component keeps a visible English string.

## Alternatives considered
- **A language switch per browser:** the operator could read the panel in one language while the bot speaks another; the clinic asked for one choice.
- **A hand-written `t()` function:** no new dependency, but no plurals or interpolation formatting, which the panel needs ("3 messages").
- **Machine translation at runtime:** unpredictable texts in a tool the staff relies on.

## Consequences
- A new dependency in the panel (`react-i18next` and `i18next`), approved by the owner.
- Every visible text of the panel moves to the two files: a large but mechanical change, done page by page.
- Changing the language does not translate the brochure; the clinic edits it.
