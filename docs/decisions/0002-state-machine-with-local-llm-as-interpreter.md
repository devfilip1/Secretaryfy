# 0002 · Deterministic state machine; the local LLM only interprets

**Status:** Accepted · **Date:** 2026-10-18

## Context
Scheduling had to run on a local model. The installed `llama3` (8B, 4-bit) has no tool calling in Ollama and gets relative dates wrong, but labels intent well when its output is constrained. A booking mistake (wrong time, double booking, booking without consent, claiming "booked" when it isn't) is far worse than a clumsy sentence.

## Decision
Scheduling is a deterministic state machine in Node ([flow.ts](../../src/modules/scheduling/flow.ts)). The model only turns a message into `{intent, option, date, name, service}`:
1. Rules first: option numbers, yes/no, simple dates and times, names, services, closings. Most messages never reach the model.
2. Otherwise Ollama `/api/chat` with a JSON Schema `format` and `temperature: 0`; the result is validated with zod. Invalid output counts as "not understood".
3. Code decides the next step, reads the calendar, writes the event and writes every reply from fixed templates. Days and times are offered as numbered options, so most answers are a number.

## Alternatives considered
- An agent with tool calling (the model calls free/busy and insert): needs a tool-capable model, and model errors become calendar errors.
- Model-written replies: more natural, but no guarantee it never says something false, and slower.
- Rules only: can't handle "can I come in sometime next week?".

## Consequences
- The critical guarantees (times within the rules, no double booking, nothing without "yes") depend on testable code, not on the model. The real-model evaluation scores 23 of 23 scenarios.
- A small, free, private model is enough, and swapping models is one env var (`AGENT_MODEL`) plus a run of `scripts/eval-scheduling.ts`.
- Replies are fixed English templates; they read a bit mechanical.
- Every new way of phrasing something either gets a rule in [interpret.ts](../../src/modules/scheduling/interpret.ts) or depends on the model; rules must be kept in step with the prompt.

**Evidence:** [interpret.ts](../../src/modules/scheduling/interpret.ts), [ollama.ts](../../src/modules/scheduling/ollama.ts), [replies.ts](../../src/modules/scheduling/replies.ts), [scripts/eval-scheduling.ts](../../scripts/eval-scheduling.ts), [specs/003 research R1–R2](../../specs/003-google-calendar-scheduling/research.md)
