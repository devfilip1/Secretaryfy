@AGENTS.md

# Secretaryfy

WhatsApp assistant for a clinic (demo: DentalSafe): brochure answers via RAG, booking on Google Calendar, reminders, and a web panel for staff. Full documentation in [docs/](docs/README.md).

## Structure
- `src/` — Node/TS server. `modules/` = business logic (no HTTP); `routes/` = Fastify plugins and the wiring of process-wide instances (`inbox.ts`, `calendar.ts`, `scheduling.ts`)
- `web/` — React panel (hash routes, SSE)
- `rag/` — Python RAG service copied from RagLab; has its own README and rules
- `specs/NNN-*/` — feature specs (Spec Kit, Portuguese); code comments cite their ids (`FR-…`, `R…`)
- `scripts/` — simulate a customer, evaluate scheduling with the real model

## Commands
```bash
npm run dev            # server :3000 (needs docker compose up -d, RAG on :8001, Ollama)
npm run dev:web        # panel :5173
npm test               # run before declaring a task done
npm run typecheck      # server + panel; run before declaring a task done
npm run db:generate    # after changing src/db/schema.ts; review the SQL, then
npm run db:migrate
npx tsx --env-file=.env scripts/eval-scheduling.ts   # after touching interpret/router/flow (needs Ollama)
npx tsx --env-file=.env scripts/eval-interpret.ts     # natural phrases through the interpreter (needs Ollama)
npx tsx --env-file=.env scripts/eval-extractors.ts     # focused extractors: time, part of the day, day named, option position (needs Ollama)
cd rag && .\run.ps1 test                             # RAG unit tests
```

## Rules the code doesn't show
- Every WhatsApp send goes through the gate (`gate.sendAssistant` / `gate.sendOperator` in `src/modules/antiban/gate.ts`). Never call `evolution.ts` send functions directly.
- The model only interprets, and rephrases flow replies in a warm tone (HUMANIZE_REPLIES, on by default), under a code guard (`guardRewrite` in `humanize.ts`) that falls back to the fixed text. Scheduling decisions and every reply text live in code (`flow.ts`, `replies.ts`). Do not grow keyword lists in code (weekday plurals, greeting words…): let the model understand the wording through an intent or an enum in its schema and keep the arithmetic and the texts in code. Measure with `scripts/eval-interpret.ts`.
- Facts of the message (time, part of the day, whether a day is named, chosen option) come only from focused extractors (`mentionedWhen`, `mentionedOption`) with a quote the code checks in the message, merged in `understanding/resolve.ts`. A new misreading is a new phrase in `scripts/eval-extractors.ts` plus a case in the table test of `understanding/`, not a new `if` in the router.
- Groups of intents are named constants in `src/modules/scheduling/intents.ts`, exposed as predicates (`asksForWhen(intent)`), never inline arrays of intent strings.
- Appointments belong to the **phone**, not the conversation (`conversation_id` can be null). Booking from anywhere goes through `bookSlot` in `scheduling/booking.ts`.
- Google Calendar is the source of truth: call `syncAppointment` before acting on a stored appointment.
- Single process only: calendar lock, send queue, SSE bus and reminder timer are in memory.
- Customer notes must never reach the assistant (interpreter, RAG history, known name).
- The service list lives only in `scheduling/services.ts`. The panel reads it from `GET /api/services` (`web/src/components/NewAppointment.tsx` keeps no copy), so change it there only.
- Patient-facing text follows `clinic.language` (en/pt, `clinic_settings.language`, read at each use; `CLINIC_LANGUAGE` only seeds it); operator/panel text is English; code comments, logs and specs are Portuguese.
- Modules take dependencies as `createX(deps)`; tests inject PGlite (`src/test/db.ts`), the fake calendar and a clock. Tests must not import `src/routes/{inbox,calendar,scheduling}.ts`.
- Tests are `*.test.ts` next to the code and excluded from `tsc`.
- Many files use CRLF line endings; `router.ts` and some others use LF. Preserve each file's style.
- Commit messages in English, with no co-author or "generated with" lines.

## How to work in this repo (every session)
The main agent plans and reviews; Haiku subagents write the code. This is a standing instruction from the owner, so no extra request is needed.
1. **Plan first.** Read the plan pages in ai-memory (`plans/…`, start with `plans/proximos-passos-2026-11-06.md`) and the docs in "Where to read before changing". Write a short plan and split it into pieces that touch **different files**, so no two writers collide. Use the task list.
2. **Delegate the coding.** Start one Haiku subagent per piece (Agent tool, `model: "haiku"`, in parallel when the pieces are independent). Each brief names the files, the behavior to build, the tests to write or fix and what "done" means, quotes the rules of this file (CRLF or LF per file, no keyword lists in code, `createX(deps)`, comments and logs in Portuguese, every patient-facing text through `replies`), and says: do not commit, do not push, touch only your files.
3. **Review everything yourself.** Read each diff before accepting it. Run `npm run typecheck` and `npm test` (and `cd rag && .un.ps1 test` with a clean environment when Python changed); run the evals named in "Commands" when `interpret`, `router`, `flow` or a RAG prompt changed. Send a piece back or fix it when it is wrong. Check the screen in the browser pane, typing in the fake WhatsApp chat like a patient, and the panel on desktop and phone width.
4. **Only the main agent commits** (English messages, no co-author line) and opens or updates the PR. Decisions, migrations, deletions of data and anything outward-facing stay with the main agent and the owner.
5. **Spend few tokens.** Short answers, say what you are doing, never stay silent for long, ask before long evaluations and before a new dependency.

## Where to read before changing
| Changing | Read |
|---|---|
| A business rule or validation | [docs/business-rules.md](docs/business-rules.md) |
| How a message is handled or answered | [docs/message-pipeline.md](docs/message-pipeline.md) |
| Panel pages, navigation, real-time | [Front-end](docs/architecture.md#front-end) |
| Routes or payloads | [docs/api.md](docs/api.md) and the contract in `specs/NNN/contracts/` |
| Tables or migrations | [docs/data-model.md](docs/data-model.md) |
| Evolution, Google, Ollama, RAG | [docs/integrations.md](docs/integrations.md) |
| Env vars, setup, tests | [docs/development.md](docs/development.md) |
| An architectural choice | [docs/decisions/](docs/decisions/README.md) |

## Keeping the docs current
- Changed a business rule, route, entity or environment variable → update the matching file in `docs/` (and `.env.example` for env vars) in the same task.
- New architectural decision → new ADR in `docs/decisions/`; mark the old one "Superseded by NNNN" instead of rewriting it.
- Touched `docs/` → update "Last updated" at the end of `docs/README.md`.
