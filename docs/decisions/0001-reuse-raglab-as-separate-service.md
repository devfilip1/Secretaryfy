# 0001 · Reuse RagLab as a separate Python service

**Status:** Accepted · **Date:** 2026-10-15

## Context
The brochure assistant already existed in the RagLab project: a Python RAG over the DentalSafe PDF, with a tuned prompt, synonyms, chunking strategies and an evaluation bench (96% on its answer key). Secretaryfy's server is Node/TypeScript.

## Decision
Copy RagLab's files into [`rag/`](../../rag) without git history, leave the pipeline and the evaluation unchanged, and add a small FastAPI server (`/health`, `/answer`, `/retrieve`) that the Node server calls over HTTP on `127.0.0.1:8001`. Later, conversation history was added to `/answer` so follow-ups like "how much does it cost?" work.

## Alternatives considered
- Rewrite the RAG in TypeScript: loses the measured quality and the bench.
- git subtree or submodule: history noise for two projects that will diverge; the spec ruled out submodules.
- Install RagLab as a pip package: would require turning it into a library first.

## Consequences
- The proven answers and the evaluation bench came for free; any RAG change can still be measured with `.\run.ps1 eval`.
- One more process to run, with Python 3.14 and its own venv.
- The two copies drift apart; fixes in RagLab must be ported by hand.
- Timeouts and failures between Node and Python are handled explicitly: the patient gets an "unavailable" message, never a late answer.

**Evidence:** [rag/README.md](../../rag/README.md), [rag/server.py](../../rag/server.py), [src/modules/rag/client.ts](../../src/modules/rag/client.ts), [specs/001 research](../../specs/001-rag-whatsapp-dentalsafe/research.md)
