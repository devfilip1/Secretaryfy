# 0011 · Grounded answers: built, measured, not adopted by default

**Status:** Accepted · **Date:** 2026-11-04

## Context
The RAG sometimes invents facts that sound plausible ("we have parking"). Grounded mode (`RAG_GROUNDED=1`) makes the model answer in JSON with an evidence quote; the code checks the quote against the retrieved chunks, checks every number, writes the refusal itself and accepts small talk only by regex. An optional second model call (`RAG_VERIFY_SUPPORT=1`) asks whether the quote supports the answer.

## Decision
Keep both modes in the code, **off by default**. The reference run stays the plain mode.

Measured on new question sets written without looking at results (64 per language, qwen3:8b):

| Mode | EN | PT | p50 |
|---|---|---|---|
| plain | 58 | 57 | 0.7 to 1.0 s |
| grounded | 55 | 57 | 1.4 to 1.5 s |
| grounded + support | 53 | 59 | 1.7 s |

## Alternatives considered
- Grounded on by default: it refuses prompt manipulation by structure (EN 2 failures to 1, PT 4 to 1), but it is not better in total, doubles latency, and fails more near-miss questions in PT (a real quote about a neighbouring topic passes the check).
- Support check on: fixes some PT near-misses, adds wrong refusals in EN, +0.3 s. Noisy.
- A code-only topic-term check: not tried. The gain does not justify another measurement round.

## Consequences
- A quote proves the text exists, not that it answers the question. This is the limit of the technique.
- Anyone who wants manipulation refused by structure can turn it on per deployment.
- Do not repeat this measurement without a different technique.

**Evidence:** [grounded.py](../../rag/assistant/generation/grounded.py), "New question sets" in [rag/evaluation/README.md](../../rag/evaluation/README.md)
