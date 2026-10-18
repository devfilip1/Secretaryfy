# rag — the DentalSafe assistant

The RAG assistant of the fictional DentalSafe clinic and the bench that measures it, copied from the RagLab project (commit `4913779`). Secretaryfy uses it to answer WhatsApp messages.

## What is the same as RagLab

The brochure, the system prompt and refusal sentence, the synonyms and stop words, the chunking strategies, the search experiments, the answer key, the evaluation code, and the reference runs (`evaluation/runs/baseline.json` and the two runs it points to).

Measured right after the copy (run `20261015-233316`, compared with the reference `20261011-191541`): 96.1% (49 of 51), with no question going from right to wrong. The search bench gave `section_hybrid` 44/44.

## What was added

| File | What |
|---|---|
| `server.py` | HTTP service used by Secretaryfy (`/health`, `/answer`, `/retrieve`) |
| `tests/unit/test_server.py` | Tests of the service, with no model needed |
| `serve` shortcut | In `run.ps1` and `Makefile`, and listed in `tests/unit/test_shortcuts.py` |
| `requirements.txt` | `fastapi`, `uvicorn`, `httpx` |

## Setup

Requires Python 3.14 and [Ollama](https://ollama.com) with `llama3` and `nomic-embed-text`.

```powershell
python -m venv .venv
.\run.ps1 install
.\run.ps1 ingest
.\run.ps1 serve
```

`serve` listens on `127.0.0.1:8001`; set `RAG_HOST` and `RAG_PORT` in `rag/.env` to change it. Like the chat, it refuses to start with a missing or out-of-date index and prints the command that fixes it. A stopped Ollama does not stop it from starting; `/health` reports it instead.

## HTTP service

| Route | Returns |
|---|---|
| `GET /health` | 200 when Ollama is reachable and the index is current, 503 otherwise; the body says which |
| `POST /answer` `{"question": "..."}` | `answer`, the `chunks` sent to the model (rank, content, score, similarity), `latency_s`, `experiment` |
| `POST /retrieve` `{"question": "..."}` | The same `chunks`, without generating an answer |

An empty question returns 422 without calling the model. A failure talking to Ollama returns 503 with `detail`. The service uses the experiment in the `assistant:` line of `config/experiments.yaml`, the same one the chat and the evaluation use.

## Commands

`.\run.ps1 help` lists every shortcut (`make <name>` on Linux/macOS). The main ones:

```powershell
.\run.ps1 test          # unit tests, no Ollama
.\run.ps1 validate      # configuration and answer key
.\run.ps1 kb-check      # index sanity
.\run.ps1 experiments   # search bench, seconds
.\run.ps1 eval          # answers on dev, compared with the reference
```

The evaluation manual is in [evaluation/README.md](evaluation/README.md).

## Rules that still apply

- Any change that can affect answers (prompt, synonyms, chunking, search) is measured with `evaluation run --no-judge` and compared with the reference. Read the regressions before the score.
- One or two questions of difference are noise with `llama3`. Confirm with `--repeat 3` before claiming a change.
- Never tune on the reserved questions; `--holdout` runs once after a round of changes.
- `NO_ANSWER` in `assistant/pipeline.py` and `ABSTENTION_PATTERNS` in `evaluation/answer_metrics.py` must stay in step.
- `assistant` never imports `evaluation` or `server`.
- The Makefile and `run.ps1` offer the same shortcuts; `tests/unit/test_shortcuts.py` checks it.
