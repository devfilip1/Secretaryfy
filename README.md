# Secretaryfy

A WhatsApp assistant for clinics. It answers patients' questions from the clinic's brochure, books, reschedules and cancels appointments on the clinic's Google Calendar, and sends a reminder the day before, all on a small **local** model (`llama3` 8B via Ollama) with no paid API. Staff follow every conversation live in a web panel and can take over at any time. The demo clinic is the fictional **DentalSafe**.

**Stack:** Node 24 + TypeScript · Fastify 5 · PostgreSQL 17 + Drizzle · React 19 + Vite 8 · Python 3.14 RAG (FastAPI, Chroma, BM25) · Ollama · Evolution API v2.3.7 · Google Calendar API

## Highlights

- **Reliable on a small model:** deterministic code decides and writes every scheduling reply; the model only interprets the message, and rules handle most messages before it. 23/23 booking scenarios pass against the real model ([why](docs/decisions/0002-state-machine-with-local-llm-as-interpreter.md)).
- **Brochure answers** from the RAG reused from the RagLab project (96% on its answer key), with conversation context.
- **Google Calendar is the source of truth:** only truly free times are offered, double booking is impossible, and edits made directly in Google are respected.
- **Number protection:** every message passes an anti-ban gate (human-like pacing, volume limits, 24 h window, no repeats, opt-out, warm-up, automatic brake). It reduces the ban risk of an unofficial connection; it can't remove it.
- **Web panel** (English, works on phones): live conversations, operator takeover, appointments for today/tomorrow/the week, booking for patients who call, customer registry with notes, WhatsApp and calendar connection.

## Getting started

Requires Node 24, Docker Desktop, Python 3.14 and [Ollama](https://ollama.com).

```bash
ollama pull llama3 && ollama pull nomic-embed-text

# RAG service (PowerShell, in rag/)
python -m venv .venv
.\run.ps1 install
.\run.ps1 ingest
.\run.ps1 serve              # http://127.0.0.1:8001

# Server (in the root)
npm install
cp .env.example .env         # fill in the variables
docker compose up -d         # Postgres :5434, Redis, Evolution API :8080
npm run db:migrate
npm run dev                  # http://localhost:3000

# Panel
npm run dev:web              # http://localhost:5173
```

Sign in with `OPERATOR_PASSWORD`, pair the number under **Connection** and connect Google under **Calendar**. Environment variables, Google Cloud setup, tests and troubleshooting: [docs/development.md](docs/development.md).

```bash
npm test                     # server tests (in-memory Postgres, no network)
npm run typecheck            # server and panel
```

## Structure

```
src/        Node server: Fastify routes and business modules (scheduling, anti-ban, inbox, reminders, …)
web/        Web panel (React + Vite)
rag/        Brochure assistant (Python RAG service, copied from RagLab; own README)
scripts/    Simulate a customer, seed a conversation, evaluate scheduling with the real model
drizzle/    Database migrations
specs/      Feature specs 001–006 (Portuguese, Spec Kit)
docs/       Project documentation
```

## Documentation

| Document | Answers |
|---|---|
| [Overview](docs/README.md) | Documentation map, one-screen overview, open questions |
| [Product](docs/product.md) | What it does, for whom, main journeys, glossary |
| [Business rules](docs/business-rules.md) | Scheduling, reminders, names, anti-ban and panel rules, with code links |
| [Architecture](docs/architecture.md) | Components, code layout, front-end, risks |
| [Message pipeline](docs/message-pipeline.md) | From a WhatsApp message to the reply, end to end |
| [API](docs/api.md) | Webhook, panel API and real-time events |
| [Data model](docs/data-model.md) | Tables, relationships and lifecycles |
| [Integrations](docs/integrations.md) | Evolution API, Google Calendar, Ollama, RAG service |
| [Development](docs/development.md) | Setup, environment, tests, evaluation, common tasks |
| [Decisions](docs/decisions/README.md) | Architecture decision records |
