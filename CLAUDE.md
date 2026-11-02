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
cd rag && .\run.ps1 test                             # RAG unit tests
```

## Rules the code doesn't show
- Every WhatsApp send goes through the gate (`gate.sendAssistant` / `gate.sendOperator` in `src/modules/antiban/gate.ts`). Never call `evolution.ts` send functions directly.
- The model only interprets. Scheduling decisions and every reply text live in code (`flow.ts`, `replies.ts`). Prefer a rule in `interpret.ts` over prompt changes.
- Appointments belong to the **phone**, not the conversation (`conversation_id` can be null). Booking from anywhere goes through `bookSlot` in `scheduling/booking.ts`.
- Google Calendar is the source of truth: call `syncAppointment` before acting on a stored appointment.
- Single process only: calendar lock, send queue, SSE bus and reminder timer are in memory.
- Customer notes must never reach the assistant (interpreter, RAG history, known name).
- The service list exists twice: `scheduling/services.ts` and `web/src/components/NewAppointment.tsx`. Change both.
- Patient- and operator-facing text is English; code comments, logs and specs are Portuguese.
- Modules take dependencies as `createX(deps)`; tests inject PGlite (`src/test/db.ts`), the fake calendar and a clock. Tests must not import `src/routes/{inbox,calendar,scheduling}.ts`.
- Tests are `*.test.ts` next to the code and excluded from `tsc`.
- Many files use CRLF line endings; `router.ts` and some others use LF. Preserve each file's style.
- Commit messages in Portuguese, with no co-author or "generated with" lines.

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
