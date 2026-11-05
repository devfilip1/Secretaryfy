# rag — the DentalSafe assistant

The RAG assistant of the fictional DentalSafe clinic and the bench that measures it, copied from the RagLab project (commit `4913779`). Secretaryfy uses it to answer WhatsApp messages.

## What is the same as RagLab

The brochure, the prompt texts (`config/prompts.yaml`, shared by every language), the refusal sentence and the synonyms and stop words (in `config/languages/<language>.yaml` and `config/clinic.yaml`), the chunking strategies, the search experiments, the answer key, the evaluation code, and the reference runs (`evaluation/runs/baseline.json` and the two runs it points to).

Measured right after the copy (run `20261015-233316`, compared with the reference `20261011-191541`): 96.1% (49 of 51), with no question going from right to wrong. The search bench gave `section_hybrid` 44/44.

## What was added

| File | What |
|---|---|
| `server.py` | HTTP service used by Secretaryfy (`/health`, `/answer`, `/retrieve`, `/reindex`) |
| `tests/unit/test_server.py` | Tests of the service, with no model needed |
| `serve` shortcut | In `run.ps1` and `Makefile`, and listed in `tests/unit/test_shortcuts.py` |
| `requirements.txt` | `fastapi`, `uvicorn`, `httpx` |

## Setup

Requires Python 3.14 and [Ollama](https://ollama.com) with `qwen3:8b` and `embeddinggemma`.

```powershell
python -m venv .venv
.\run.ps1 install
.\run.ps1 ingest
.\run.ps1 serve
```

`serve` listens on `127.0.0.1:8001`; set `RAG_HOST` and `RAG_PORT` in `rag/.env` to change it. Like the chat, it refuses to start with a missing or out-of-date index and prints the command that fixes it, with one exception described below. A stopped Ollama does not stop it from starting; `/health` reports it instead.

## Startup and /health

With the file source (`KNOWLEDGE_URL` empty) the rule is strict: the server refuses to start when the index is missing, out of date for any reason, or built with another embedding size.

With the Node server as knowledge source (`KNOWLEDGE_URL` set), the owner may edit the knowledge before publishing it, so the knowledge version can differ from the one the index was built from. The server then decides on the reason:

| Situation at startup | Result |
|---|---|
| Index missing | Refuses: `Could not start`, with the ingest command |
| Strategy definition or embedding model changed | Refuses, with the ingest command |
| Knowledge version changed (unpublished edits) | Starts, answering from the last published index; prints one `Warning:` line |
| Knowledge server unreachable, index present | Starts, answering from the last published index; prints one `Warning:` line |

The chat and the ingest command keep the strict rule for both sources.

`GET /health` reports:

- `index.state`: `current`, `stale` or `missing`, computed from the manifest and the knowledge version when the Node server answers. When it does not answer, the state is judged from the manifest alone (no knowledge version is compared).
- `index.built_from`: the knowledge version the index was built from (the manifest `source_hash`), or `null` without an index. The panel compares it with the Node version to show "up to date" or "unpublished". It exists for both sources.
- `knowledge`: `{"source": "file" | "http", "version": ...}` when the knowledge is read. When the Node server cannot be reached: `{"source": "http", "version": null, "reachable": false}`.

The Node server's version is kept for 5 seconds inside the process, so one `/health` call does not fetch the whole document twice. `/health` answers 200 when Ollama is reachable and the index is current, so a Node server that is down does not turn a built index into a 503.

## HTTP service

| Route | Returns |
|---|---|
| `GET /health` | 200 when Ollama is reachable and the index is current, 503 otherwise; the body says which (see [Startup and /health](#startup-and-health)) |
| `POST /answer` `{"question": "..."}` | `answer`, the `chunks` sent to the model (rank, content, score, similarity), `latency_s`, `experiment` |
| `POST /retrieve` `{"question": "..."}` | The same `chunks`, without generating an answer |
| `POST /reindex` | Rebuilds the index of every strategy from the knowledge now served and reports `chunks` per strategy and the knowledge `version`. Bearer token `INTERNAL_TOKEN`; 401 without it, 409 while another reindex runs, 503 when the knowledge server fails, 404 when `INTERNAL_TOKEN` is empty |

An empty question returns 422 without calling the model. A failure talking to Ollama returns 503 with `detail`. The service uses the experiment in the `assistant:` line of `config/experiments.yaml`, the same one the chat and the evaluation use.

## Environment

Read from the environment or from `rag/.env` (see `.env.example`). The defaults apply when a variable is not set.

| Variable | Default | What |
|---|---|---|
| `KNOWLEDGE_URL` | empty | The Node server that owns the knowledge: `GET` this URL with `Authorization: Bearer <INTERNAL_TOKEN>` answers `{"name", "version", "sections": [{"title", "body"}]}`. When set, `KNOWLEDGE_PATH` is not read |
| `INTERNAL_TOKEN` | empty | Bearer token for `KNOWLEDGE_URL` and for `POST /reindex`. Empty turns `/reindex` off |
| `KNOWLEDGE_PATH` | `data/source/DentalSafe.pdf` | The knowledge file when `KNOWLEDGE_URL` is empty: a PDF, or a Markdown file with one `## Title` per subject |
| `INDEX_DIR` | `data/index` | Where the indexes are written |
| `RAG_HOST` / `RAG_PORT` | `127.0.0.1` / `8001` | Address of the HTTP service |

With `KNOWLEDGE_URL`, `/health` reports `knowledge: {source: "http" | "file", version}`; when the knowledge server is down it reports `reachable: false` instead (see [Startup and /health](#startup-and-health)).

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
- One or two questions of difference are noise with `qwen3:8b`. Confirm with `--repeat 3` before claiming a change.
- Never tune on the reserved questions; `--holdout` runs once after a round of changes.
- `no_answer` in `config/languages/<language>.yaml` and the `abstention_patterns` of that language's `Locale` in `evaluation/normalize.py` must stay in step.
- `assistant` never imports `evaluation` or `server`.
- The Makefile and `run.ps1` offer the same shortcuts; `tests/unit/test_shortcuts.py` checks it.
