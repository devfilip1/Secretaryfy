# Development

## Prerequisites

- **Node.js 24** and npm
- **Docker Desktop** (Postgres 17, Redis, Evolution API)
- **Python 3.14** (RAG service)
- **[Ollama](https://ollama.com)** with `llama3` and `nomic-embed-text` pulled
- A **WhatsApp number** to connect (ideally not a personal one; see the [anti-ban advice](#keeping-the-number-safe))
- A **Google Cloud project** with an OAuth client, and a Google account whose calendar the clinic uses

The scripts in this repo are written for Windows (PowerShell for `rag/run.ps1`); `rag/Makefile` offers the same shortcuts on Linux/macOS.

## Running locally

Four things run at once: Docker, the RAG service, the server and (in development) the panel.

```bash
# 1. Models
ollama pull llama3
ollama pull nomic-embed-text

# 2. RAG service (PowerShell, from rag/)
python -m venv .venv
.\run.ps1 install
.\run.ps1 ingest      # builds the index in rag/data/index/
.\run.ps1 serve       # http://127.0.0.1:8001 — check GET /health → "status": "ready"

# 3. Server (from the root)
npm install
cp .env.example .env  # fill in the variables below
docker compose up -d  # Postgres :5434, Redis, Evolution API :8080
npm run db:migrate
npm run dev           # http://localhost:3000

# 4. Panel
npm run dev:web       # http://localhost:5173, proxies /api to :3000
```

Then, in the panel: sign in with `OPERATOR_PASSWORD` → **Connection** → scan the QR code in *WhatsApp > Linked devices* → **Calendar** → connect Google, pick a calendar (a test calendar is recommended) and save the rules.

To open the panel on a phone on the same network: `npm run dev:web -- --host` and browse to the machine's LAN address on port 5173.

**Production-like run:** `npm run build` (server to `dist/`, panel to `web/dist/`), then `npm start`; panel and API are both on :3000.

## Environment variables

All are validated at startup by [env.ts](../src/config/env.ts); a bad value stops the server with a message. Documented with defaults in [.env.example](../.env.example).

| Variable | Required | What it is / where to get it |
|---|---|---|
| `PUBLIC_URL` | yes | Server's public address; the Google redirect URI is `${PUBLIC_URL}/auth/google/callback` |
| `DATABASE_URL` | yes | Postgres URL (docker compose: port 5434) |
| `APP_SECRET` | yes | 32 random bytes in base64; encrypts the Google token and signs sessions. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | Google Cloud Console → APIs & Services → Credentials (OAuth client) |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` | yes | Evolution API address, its key (the same value docker compose passes as `AUTHENTICATION_API_KEY`), and instance name |
| `EVOLUTION_WEBHOOK_TOKEN` | yes | Random secret of 16+ characters, put in the webhook URL |
| `WEBHOOK_BASE_URL` | no | Server address as seen from Docker: `http://host.docker.internal:3000` |
| `OPERATOR_PASSWORD` | no | Panel password, 12+ characters; without it the panel is off |
| `PANEL_URL` | no | Where Google returns after consent; `http://localhost:5173` in development |
| `ANTHROPIC_API_KEY` | yes | Any value; currently unused (see [open questions](README.md#open-questions)) |
| `RAG_SERVICE_URL`, `RAG_TIMEOUT_MS` | no | RAG service address (`http://127.0.0.1:8001`) and timeout (30000) |
| `OLLAMA_URL`, `AGENT_MODEL`, `AGENT_TIMEOUT_MS` | no | Interpreter: Ollama address, model (`llama3`), timeout (20000) |
| `REMINDER_LEAD_MINUTES`, `REMINDER_CUTOFF_MINUTES`, `REMINDER_TICK_MS` | no | Reminder window (1440 / 120 min) and scheduler tick (60000 ms). Shorten only to test |
| `ANTIBAN_*` | no | About 30 anti-ban limits; the ones most likely to change: `ANTIBAN_CONVERSATIONS_PER_DAY` (150), `ANTIBAN_PER_MINUTE` / `ANTIBAN_PER_HOUR` (8 / 200), `ANTIBAN_ALLOWED_LINK_DOMAINS` (empty), `ANTIBAN_WARMUP_DAYS` (14; 0 turns it off) |
| `DATABASE_URL_TEST` | no | Real Postgres for tests; without it tests use in-memory PGlite |
| `PORT`, `LOG_LEVEL` | no | 3000, `info` |

The RAG service reads `rag/.env` (`RAG_HOST`, `RAG_PORT`, Ollama settings); see [rag/.env.example](../rag/.env.example).

## Google Calendar setup

Once, in the [Google Cloud Console](https://console.cloud.google.com/), in the project of `GOOGLE_CLIENT_ID`:
1. **APIs & Services → Library:** enable the **Google Calendar API**.
2. **Credentials**, on the OAuth client: add the redirect URI `${PUBLIC_URL}/auth/google/callback`.
3. **OAuth consent screen:** add the scopes `calendar.events`, `calendar.calendarlist.readonly`, `calendar.events.freebusy`, and the clinic's Gmail as a **test user**.

The server logs a warning at startup if the Google credentials don't look real.

## Tests

```bash
npm test             # server: node:test + in-memory Postgres (PGlite), fake calendar, no network
npm run typecheck    # server and panel
cd rag && .\run.ps1 test   # RAG unit tests, no Ollama needed
```

- Tests live next to the code (`*.test.ts`) and are excluded from `tsc`. [setup-env.ts](../src/test/setup-env.ts) fills required env vars with fake values; [db.ts](../src/test/db.ts) creates a PGlite database with the migrations applied; [fake-calendar.ts](../src/test/fake-calendar.ts) and [clock.ts](../src/test/clock.ts) replace Google and time.
- Covered: every module and route, including the webhook, the router, the state machine, the gate and the reminder scheduler. Not covered: the panel UI (checked by hand), real Evolution/Google calls.

### Evaluating with the real model

```bash
npx tsx --env-file=.env scripts/eval-scheduling.ts                    # 23 scripted conversations, fake calendar
npx tsx --env-file=.env scripts/eval-scheduling.ts --only "name"      # one scenario
AGENT_MODEL=llama3.1:8b npx tsx --env-file=.env scripts/eval-scheduling.ts   # compare another model
```

Scenarios are in [scheduling-scenarios.json](../scripts/fixtures/scheduling-scenarios.json). It checks that offered times follow the rules, nothing is double-booked, nothing is booked without "yes", the right time is booked in at least 90% of scenarios, replies take under 30 s, and the service is in the event title. Run it after any change to the interpreter, the router or the flow.

The RAG has its own bench (`.\run.ps1 eval`); see [rag/evaluation/README.md](../rag/evaluation/README.md).

### Manual testing without a second phone

```bash
npx tsx --env-file=.env scripts/simulate-customer.ts "I'd like to book an appointment"
npx tsx --env-file=.env scripts/simulate-customer.ts "2"
```

The message is posted to the webhook as if it came from your own number; the reply arrives in your WhatsApp "You" chat. Options: `--phone`, `--name`.

`node --env-file=.env --import tsx scripts/seed-conversation.ts [phone] [count]` fills a large conversation to test the panel.

To test reminders without waiting a day: set `REMINDER_LEAD_MINUTES=10`, `REMINDER_CUTOFF_MINUTES=2`, `REMINDER_TICK_MS=15000`, restart, and follow [specs/006 quickstart](../specs/006-panel-appointments-reminders/quickstart.md). Reset them afterwards.

## Build and deploy

There is no deployment setup yet: no Dockerfile for the server or the RAG service, no CI. `npm run build` + `npm start` is the production-like path. The server must run as **a single process** ([ADR 0007](decisions/0007-single-process-in-memory-coordination.md)). `PUBLIC_URL` must be reachable by Google (OAuth redirect); behind HTTPS the session cookie becomes `Secure` automatically.

## Keeping the number safe

The gate can't fix what's outside the code. For the clinic's number:
- set a profile photo, name and description;
- don't use a virtual number, and wait at least a day between registering the number and pairing the QR code;
- ask patients to save the number, and advertise a `wa.me` link so the patient writes first;
- keep the Evolution API updated and from the official source.

## Conventions

- **Spec-driven:** each feature starts as a spec in `specs/NNN-name/` (spec → plan → tasks → implement, with Spec Kit). Requirement ids (`FR-…`, `SC-…`, `R…`) are cited in code comments.
- **Language:** code identifiers in English; code comments, logs, commit messages and specs in Portuguese; everything the patient or operator reads (assistant replies, panel) in English.
- **Dependency injection:** modules export `createX(deps)` factories; real instances are wired in `src/routes/{inbox,calendar,scheduling}.ts`. Don't import those wiring files from modules or tests.
- **Every WhatsApp send goes through the gate** (`gate.sendAssistant` / `gate.sendOperator`). Never call `evolution.ts` directly.
- **Reply texts live in code** ([replies.ts](../src/modules/scheduling/replies.ts), [texts.ts](../src/modules/antiban/texts.ts)); the model never writes what the patient reads in scheduling.
- **Migrations:** change [schema.ts](../src/db/schema.ts), run `npm run db:generate`, review (and edit if needed, e.g. backfills) the SQL in `drizzle/`, then `npm run db:migrate`.
- **Commits:** Portuguese, one per feature step; no co-author or "generated with" lines.

## Common tasks

- **Add a panel API route:** add it to the matching `src/routes/panel-*.ts` (all `/api/*` routes are authenticated by the hook in [panel-session.ts](../src/routes/panel-session.ts)), validate with zod, add a `*.test.ts` using `app.inject`, add the client function in [web/src/api.ts](../web/src/api.ts), and update [api.md](api.md).
- **Add a panel page:** create `web/src/pages/X.tsx`, add the hash and the tab in [App.tsx](../web/src/App.tsx), subscribe to SSE with `useInboxEvents` if it shows live data, style it in [styles.css](../web/src/styles.css) and check it at 375 px.
- **Change what the assistant understands:** add rules in [interpret.ts](../src/modules/scheduling/interpret.ts) before touching the prompt, add cases to `interpret.test.ts`, and run `scripts/eval-scheduling.ts`.
- **Add a service to the catalog:** edit `SERVICES` in [services.ts](../src/modules/scheduling/services.ts) (name as in the brochure, plus trigger words) **and** the copy of the list in [NewAppointment.tsx](../web/src/components/NewAppointment.tsx), in the same order. The API rejects a service that isn't in `SERVICES`.
